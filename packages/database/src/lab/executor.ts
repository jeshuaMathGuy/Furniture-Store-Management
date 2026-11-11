import type { FieldPacket, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { Pool } from "../connection.js";
import { classifySql, normalizeSql, type Classification, type ExplainFormat, type SqlParserLike, type StatementKind } from "./classifier.js";

/**
 * Read-only SQL execution for the playground.
 *
 * Layers, outermost first:
 *  1. MySQL privileges: the pool MUST be the lab_reader pool (the real security boundary).
 *  2. Parser classification (classifier.ts): one SELECT/WITH/EXPLAIN/SHOW/DESCRIBE only.
 *  3. START TRANSACTION READ ONLY, SET SESSION MAX_EXECUTION_TIME, sql_select_limit row cap.
 *  4. A watchdog that KILLs the query from a second connection if the server limit did not apply.
 *  5. The connection is always rolled back, its named locks released and its session limits restored;
 *     if any of that fails, the connection is destroyed instead of returned to the pool.
 */
export const DEFAULT_ROW_LIMIT = 500;
export const DEFAULT_MAX_EXECUTION_MS = 3000;

export interface ResultColumn { name: string; type: string; table: string | null }
export interface SqlWarning { level: string; code: number; message: string }

export interface SqlRunSuccess {
  ok: true;
  kind: StatementKind;
  sql: string;
  columns: ResultColumn[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
  warnings: SqlWarning[];
  plan?: { format: ExplainFormat; json?: unknown; text?: string };
  limits: { rowLimit: number; maxExecutionMs: number };
  /** SLEEP()/BENCHMARK() are cut short by MAX_EXECUTION_TIME without raising an error; flagged by elapsed time. */
  hitTimeLimit: boolean;
}
export interface SqlRunFailure {
  ok: false;
  stage: "classify" | "execute";
  sql: string;
  kind?: StatementKind;
  error: { message: string; code?: string; errno?: number; sqlState?: string; reason?: string };
  elapsedMs?: number;
  limits: { rowLimit: number; maxExecutionMs: number };
}
export type SqlRunResult = SqlRunSuccess | SqlRunFailure;

export interface RunOptions {
  parser: SqlParserLike;
  rowLimit?: number;
  maxExecutionMs?: number;
  /** "explain" wraps a SELECT/WITH in EXPLAIN FORMAT=JSON (or the given format). */
  mode?: "run" | "explain";
  explainFormat?: ExplainFormat;
}

const TYPE_NAMES: Record<number, string> = {
  0: "DECIMAL", 1: "TINYINT", 2: "SMALLINT", 3: "INT", 4: "FLOAT", 5: "DOUBLE", 6: "NULL", 7: "TIMESTAMP",
  8: "BIGINT", 9: "MEDIUMINT", 10: "DATE", 11: "TIME", 12: "DATETIME", 13: "YEAR", 15: "VARCHAR", 16: "BIT",
  245: "JSON", 246: "DECIMAL", 247: "ENUM", 248: "SET", 249: "TINYBLOB", 250: "MEDIUMBLOB", 251: "LONGBLOB",
  252: "BLOB/TEXT", 253: "VARCHAR", 254: "CHAR", 255: "GEOMETRY",
};

function jsonSafe(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return v.toString();
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) return `0x${v.toString("hex")}`;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
  return v;
}

function mysqlError(e: unknown): SqlRunFailure["error"] {
  const x = e as { message?: string; sqlMessage?: string; code?: string; errno?: number; sqlState?: string };
  return { message: x.sqlMessage ?? x.message ?? String(e), code: x.code, errno: x.errno, sqlState: x.sqlState };
}

/** Kill a runaway query from a second session of the same account (users may always kill their own threads). */
async function killQuery(pool: Pool, threadId: number | null) {
  if (!threadId) return;
  const k = await pool.getConnection().catch(() => null);
  if (!k) return;
  try { await k.query(`KILL QUERY ${Number(threadId)}`); } catch { /* already finished */ } finally { k.release(); }
}

export async function runReadOnlySql(pool: Pool, input: string, opts: RunOptions): Promise<SqlRunResult> {
  const rowLimit = Math.max(1, Math.min(opts.rowLimit ?? DEFAULT_ROW_LIMIT, 5000));
  const maxExecutionMs = Math.max(100, Math.min(opts.maxExecutionMs ?? DEFAULT_MAX_EXECUTION_MS, 10_000));
  const limits = { rowLimit, maxExecutionMs };
  let sql = normalizeSql(input);
  let cls: Classification = classifySql(sql, opts.parser);
  if (cls.ok && opts.mode === "explain") {
    if (cls.kind !== "select" && cls.kind !== "with" && cls.kind !== "explain")
      return { ok: false, stage: "classify", sql, kind: cls.kind, error: { message: "Only SELECT and WITH queries have an execution plan.", reason: "not_read_only" }, limits };
    if (cls.kind !== "explain") {
      sql = `EXPLAIN FORMAT=${(opts.explainFormat ?? "json").toUpperCase()} ${sql}`;
      cls = classifySql(sql, opts.parser);
    }
  }
  if (!cls.ok) return { ok: false, stage: "classify", sql, error: { message: cls.message, reason: cls.reason }, limits };
  const kind = cls.kind;

  const conn: PoolConnection = await pool.getConnection();
  let healthy = true;
  const watchdog = setTimeout(() => { void killQuery(pool, conn.threadId); }, maxExecutionMs + 2000);
  const t0 = performance.now();
  try {
    await conn.query(`SET SESSION MAX_EXECUTION_TIME = ${maxExecutionMs}`);
    // Row cap enforced by the server for the top-level result (EXPLAIN keeps the default so the plan is unaltered).
    await conn.query(kind === "explain" ? "SET SESSION sql_select_limit = DEFAULT" : `SET SESSION sql_select_limit = ${rowLimit + 1}`);
    await conn.query("START TRANSACTION READ ONLY");
    const start = performance.now();
    let rows: unknown[][];
    let fields: FieldPacket[];
    try {
      const [r, f] = await conn.query<RowDataPacket[][]>({ sql: cls.sql, rowsAsArray: true });
      rows = (r as unknown as unknown[][]) ?? [];
      fields = (f as FieldPacket[] | undefined) ?? [];
    } catch (e) {
      return { ok: false, stage: "execute", sql: cls.sql, kind, error: mysqlError(e), elapsedMs: Math.round(performance.now() - start), limits };
    }
    const elapsedMs = Math.round(performance.now() - start);
    const [w] = await conn.query<RowDataPacket[]>("SHOW WARNINGS");
    const warnings = w.map((x) => ({ level: String(x.Level), code: Number(x.Code), message: String(x.Message) }));
    const truncated = kind !== "explain" && rows.length > rowLimit;
    const kept = truncated ? rows.slice(0, rowLimit) : rows;
    const columns: ResultColumn[] = fields.map((fl) => ({
      name: fl.name,
      type: TYPE_NAMES[Number((fl as unknown as { columnType?: number }).columnType ?? fl.type)] ?? `type ${String(fl.type)}`,
      table: (fl as unknown as { orgTable?: string }).orgTable || fl.table || null,
    }));
    const result: SqlRunSuccess = {
      ok: true, kind, sql: cls.sql, columns,
      rows: kept.map((r) => (Array.isArray(r) ? r : [r]).map(jsonSafe)),
      rowCount: kept.length, truncated, elapsedMs, warnings, limits,
      hitTimeLimit: elapsedMs >= maxExecutionMs - 25,
    };
    if (kind === "explain") {
      const format = cls.explainFormat ?? "traditional";
      if (format === "json") {
        const raw = kept[0]?.[0];
        try { result.plan = { format, json: typeof raw === "string" ? JSON.parse(raw) : raw }; } catch { result.plan = { format, text: String(raw) }; }
      } else if (format === "tree") {
        result.plan = { format, text: String(kept[0]?.[0] ?? "") };
      } else {
        result.plan = { format };
      }
    }
    return result;
  } catch (e) {
    return { ok: false, stage: "execute", sql: cls.sql, kind, error: mysqlError(e), elapsedMs: Math.round(performance.now() - t0), limits };
  } finally {
    clearTimeout(watchdog);
    try {
      await conn.query("ROLLBACK");
      await conn.query("DO RELEASE_ALL_LOCKS()");
      await conn.query("SET SESSION sql_select_limit = DEFAULT, SESSION MAX_EXECUTION_TIME = DEFAULT");
    } catch {
      healthy = false;
    }
    if (healthy) conn.release(); else conn.destroy();
  }
}
