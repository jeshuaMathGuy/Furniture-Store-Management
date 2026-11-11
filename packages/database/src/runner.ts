import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ResultSetHeader } from "mysql2";
import type { DbConfig } from "./config.js";
import { connect, quoteId, type Conn } from "./connection.js";
import { splitSqlScript, type SqlStatement } from "./sql-splitter.js";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");
export const ORIGINAL_SQL = join(REPO_ROOT, "database/original/furniture_store_normalized.sql");
export const ORIGINAL_SHA256 = "1442aea4e8b0e01eb8861677761f2f0ae9f074f5da020a18f08d89964f7640ce";
const ORIGINAL_DB_NAME = "furniture_store_db";

/** The 20 permanent tables declared by the source script. */
export const ORIGINAL_TABLES = [
  "customer", "supplier", "product", "sales_order", "postal_area", "order_line",
  "warranty_plan", "order_plan", "supplier_certification", "supplier_service_region",
  "offer", "feedback", "order_status_history", "product_inventory", "goods_receipt",
  "goods_receipt_line", "loyalty_award", "supplier_settlement", "reorder_request", "audit_log",
] as const;

/** The 14 session-scoped relations the source script creates for normalization teaching. */
export const TEACHING_TEMP_TABLES = [
  "unf_customer", "unf_supplier", "unf_product", "unf_sales_order",
  "nf1_order_line", "nf1_supplier_capability",
  "nf2_order", "nf2_product", "nf2_order_line", "nf2_supplier_capability",
  "nf3_order_supplier_plan", "nf3_supplier_capability",
  "nf3_order_supplier_plan_check", "nf3_supplier_capability_check",
] as const;

export const ORIGINAL_ROUTINES = {
  PROCEDURE: ["sp_award_loyalty", "sp_build_supplier_settlements", "sp_confirm_order", "sp_queue_reorders", "sp_receive_goods"],
  FUNCTION: ["fn_discounted_price", "fn_warranty_expiry"],
} as const;
export const ORIGINAL_TRIGGERS = ["au_product", "au_sales_order", "bi_order_line", "bi_sales_order", "bu_sales_order"] as const;

/** The first operational-demo statement (source line 841). The teaching checkpoint is taken just before it. */
const OPERATIONAL_DEMO_START = /^INSERT\s+INTO\s+sales_order\s*\(order_id,customer_id,order_date,order_status\)\s*VALUES\s*\(5004/i;

export interface StatementReport {
  index: number;
  line: number;
  preview: string;
  kind: "select" | "call" | "other";
  rows?: Record<string, unknown>[];
  affectedRows?: number;
  warnings?: { level: string; code: number; message: string }[];
}

export function readOriginalSql(): string {
  const bytes = readFileSync(ORIGINAL_SQL);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== ORIGINAL_SHA256) {
    throw new Error(`Original SQL hash mismatch (${hash}). The preserved source must not be edited.`);
  }
  return bytes.toString("utf8");
}

/** Statements of the original script, retargeted in memory to `dbName`. The file on disk is never modified. */
export function originalStatements(dbName: string): SqlStatement[] {
  const src = readOriginalSql();
  const occurrences = src.match(/\bfurniture_store_db\b/g)?.length ?? 0;
  if (occurrences !== 3) throw new Error(`Expected 3 database-name references in source, found ${occurrences}`);
  const retargeted = dbName === ORIGINAL_DB_NAME ? src : src.replace(/\bfurniture_store_db\b/g, dbName);
  return splitSqlScript(retargeted);
}

async function exec(conn: Conn, stmt: SqlStatement, index: number): Promise<StatementReport> {
  const preview = stmt.sql.replace(/\s+/g, " ").slice(0, 100);
  let result: unknown;
  try {
    [result] = await conn.query(stmt.sql);
  } catch (err) {
    const e = err as Error;
    throw new Error(`Statement #${index} (source line ${stmt.line}) failed: ${e.message}\n${preview}`);
  }
  const report: StatementReport = { index, line: stmt.line, preview, kind: "other" };
  const head = stmt.sql.trimStart().slice(0, 6).toUpperCase();
  if (head.startsWith("CALL")) {
    report.kind = "call";
    const parts = Array.isArray(result) ? result : [result];
    const header = parts.find((p) => p && !Array.isArray(p)) as ResultSetHeader | undefined;
    report.affectedRows = header?.affectedRows;
  } else if (Array.isArray(result)) {
    report.kind = "select";
    report.rows = result as Record<string, unknown>[];
  } else {
    report.affectedRows = (result as ResultSetHeader).affectedRows;
  }
  const warningStatus = (Array.isArray(result) ? undefined : (result as ResultSetHeader)?.warningStatus) ?? 0;
  if (warningStatus > 0 || report.kind === "call") {
    const [w] = await conn.query("SHOW WARNINGS");
    const list = (w as { Level: string; Code: number; Message: string }[]).map((x) => ({ level: x.Level, code: x.Code, message: x.Message }));
    if (list.length) report.warnings = list;
  }
  return report;
}

async function columnsOf(conn: Conn, schema: string, table: string): Promise<{ name: string; generated: boolean }[]> {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME AS name, (GENERATION_EXPRESSION <> '') AS is_gen
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
  return (rows as { name: string; is_gen: number }[]).map((r) => ({ name: r.name, generated: !!Number(r.is_gen) }));
}

/** Copy a permanent table (structure via LIKE, then data minus generated columns). */
async function copyPermanent(conn: Conn, fromSchema: string, table: string, toSchema: string, toTable: string) {
  await conn.query(`DROP TABLE IF EXISTS ${quoteId(toSchema)}.${quoteId(toTable)}`);
  await conn.query(`CREATE TABLE ${quoteId(toSchema)}.${quoteId(toTable)} LIKE ${quoteId(fromSchema)}.${quoteId(table)}`);
  const cols = (await columnsOf(conn, fromSchema, table)).filter((c) => !c.generated).map((c) => quoteId(c.name)).join(",");
  await conn.query(
    `INSERT INTO ${quoteId(toSchema)}.${quoteId(toTable)} (${cols}) SELECT ${cols} FROM ${quoteId(fromSchema)}.${quoteId(table)}`,
  );
}

/** Copy a session TEMPORARY table into a permanent one (must run on the session that owns it). */
async function copyTemporary(conn: Conn, table: string, toSchema: string) {
  await conn.query(`DROP TABLE IF EXISTS ${quoteId(toSchema)}.${quoteId(table)}`);
  await conn.query(`CREATE TABLE ${quoteId(toSchema)}.${quoteId(table)} LIKE ${quoteId(table)}`);
  await conn.query(`INSERT INTO ${quoteId(toSchema)}.${quoteId(table)} SELECT * FROM ${quoteId(table)}`);
}

export interface RunOriginalOptions {
  dbName: string;
  /** If set, persist teaching snapshots into this schema (dropped and recreated). */
  teachingDb?: string;
}

/**
 * Execute the authoritative source script on ONE dedicated session (temporary
 * tables are session-scoped) and return a per-statement report.
 */
export async function runOriginal(cfg: DbConfig, opts: RunOriginalOptions): Promise<StatementReport[]> {
  const statements = originalStatements(opts.dbName);
  const conn = await connect(cfg, "root");
  const reports: StatementReport[] = [];
  try {
    if (opts.teachingDb) {
      await conn.query(`DROP DATABASE IF EXISTS ${quoteId(opts.teachingDb)}`);
      await conn.query(`CREATE DATABASE ${quoteId(opts.teachingDb)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    }
    let checkpointTaken = false;
    for (const [i, stmt] of statements.entries()) {
      if (opts.teachingDb && !checkpointTaken && OPERATIONAL_DEMO_START.test(stmt.sql)) {
        // Normalized relations exactly as the decomposition produced them, before operational demos mutate them.
        for (const t of ORIGINAL_TABLES) await copyPermanent(conn, opts.dbName, t, opts.teachingDb, `base_${t}`);
        checkpointTaken = true;
      }
      reports.push(await exec(conn, stmt, i));
    }
    if (opts.teachingDb) {
      if (!checkpointTaken) throw new Error("Teaching checkpoint statement (source line 841) not found");
      for (const t of TEACHING_TEMP_TABLES) await copyTemporary(conn, t, opts.teachingDb);
    }
  } finally {
    await conn.end();
  }
  return reports;
}

// ---------------------------------------------------------------- migrations

export interface Migration { id: string; file: string; targets: ("app" | "lab")[]; sql: string }

export function loadMigrations(dir = join(REPO_ROOT, "database/migrations")): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const sql = readFileSync(join(dir, file), "utf8");
      const m = /^--\s*targets:\s*([a-z, ]+)$/im.exec(sql);
      if (!m) throw new Error(`${file}: missing "-- targets: app|lab" header`);
      const targets = m[1]!.split(",").map((s) => s.trim()) as ("app" | "lab")[];
      return { id: file.replace(/\.sql$/, ""), file, targets, sql };
    });
}

export async function applyMigrations(cfg: DbConfig, dbName: string, target: "app" | "lab"): Promise<string[]> {
  const conn = await connect(cfg, "root", dbName);
  const applied: string[] = [];
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migration (
      migration_id VARCHAR(100) PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`);
    const [done] = await conn.query("SELECT migration_id, checksum FROM schema_migration");
    const doneMap = new Map((done as { migration_id: string; checksum: string }[]).map((r) => [r.migration_id, r.checksum]));
    for (const m of loadMigrations()) {
      if (!m.targets.includes(target)) continue;
      const checksum = createHash("sha256").update(m.sql).digest("hex");
      const prior = doneMap.get(m.id);
      if (prior) {
        if (prior !== checksum) throw new Error(`Migration ${m.id} was edited after being applied`);
        continue;
      }
      for (const [i, stmt] of splitSqlScript(m.sql).entries()) {
        try { await conn.query(stmt.sql); } catch (err) {
          throw new Error(`${m.file} statement ${i + 1} (line ${stmt.line}): ${(err as Error).message}`);
        }
      }
      await conn.query("INSERT INTO schema_migration (migration_id, checksum) VALUES (?, ?)", [m.id, checksum]);
      applied.push(m.id);
    }
  } finally {
    await conn.end();
  }
  return applied;
}

export async function runSqlFile(cfg: DbConfig, dbName: string, file: string): Promise<void> {
  const conn = await connect(cfg, "root", dbName);
  try {
    for (const stmt of splitSqlScript(readFileSync(file, "utf8"))) {
      try { await conn.query(stmt.sql); } catch (err) {
        throw new Error(`${file} line ${stmt.line}: ${(err as Error).message}`);
      }
    }
  } finally {
    await conn.end();
  }
}

// ---------------------------------------------------------------- reports / exports

export function writeJson(relPath: string, data: unknown) {
  const full = join(REPO_ROOT, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, JSON.stringify(data, null, 2) + "\n");
}

export async function exportSchemaTables(cfg: DbConfig, schema: string, outDir: string): Promise<string[]> {
  const conn = await connect(cfg, "root", schema);
  const names: string[] = [];
  try {
    const [tables] = await conn.query(
      "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME", [schema]);
    for (const { t } of tables as { t: string }[]) {
      const [pk] = await conn.query(
        `SELECT COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION`, [schema, t]);
      const order = (pk as { c: string }[]).map((r) => quoteId(r.c)).join(",") || "1";
      const [rows] = await conn.query(`SELECT * FROM ${quoteId(t)} ORDER BY ${order}`);
      writeJson(join(outDir, `${t}.json`), rows);
      names.push(t);
    }
  } finally {
    await conn.end();
  }
  return names;
}
