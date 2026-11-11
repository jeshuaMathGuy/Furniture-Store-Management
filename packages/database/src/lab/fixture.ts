import type { RowDataPacket } from "mysql2";
import type { DbConfig } from "../config.js";
import { connect, quoteId } from "../connection.js";

/**
 * Lab sandbox fixture.
 *
 * The web server has no root password, so it cannot rebuild the sandbox by
 * replaying the original script. Instead, setup (as root) captures a copy of
 * every lab table into `<lab>_fixture` right after the sandbox is rebuilt, plus
 * metadata that lab users cannot read from information_schema themselves
 * (trigger bodies, procedure bodies, view definitions). A reset then restores
 * the sandbox from that copy using only lab_operator DML.
 */
export function labFixtureDbName(labDb: string): string {
  const name = `${labDb}_fixture`;
  quoteId(name); // throws on an unsafe or over-long identifier
  return name;
}

/** Metadata tables stored next to the data copies. They are never restored into the sandbox. */
export const META_PREFIX = "lab_meta_";

type Q = { query: <T extends RowDataPacket[]>(sql: string, values?: unknown[]) => Promise<[T, unknown]> };

async function baseTables(conn: Q, schema: string): Promise<string[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME", [schema]);
  return rows.map((r) => r.t as string);
}

async function storedColumns(conn: Q, schema: string, table: string): Promise<string[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND GENERATION_EXPRESSION = '' ORDER BY ORDINAL_POSITION`, [schema, table]);
  return rows.map((r) => r.c as string);
}

/** Root only (setup). Drops and recreates `<lab>_fixture` from the current sandbox contents. */
export async function captureLabFixture(cfg: DbConfig): Promise<string[]> {
  const lab = cfg.LAB_DB_NAME;
  const fx = labFixtureDbName(lab);
  const c = await connect(cfg, "root");
  try {
    await c.query(`DROP DATABASE IF EXISTS ${quoteId(fx)}`);
    await c.query(`CREATE DATABASE ${quoteId(fx)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    const tables = (await baseTables(c, lab)).filter((t) => t !== "schema_migration");
    for (const t of tables) {
      // LIKE copies columns, keys and CHECKs but not foreign keys, so the copy has no FK coupling.
      await c.query(`CREATE TABLE ${quoteId(fx)}.${quoteId(t)} LIKE ${quoteId(lab)}.${quoteId(t)}`);
      const cols = (await storedColumns(c, lab, t)).map(quoteId).join(",");
      await c.query(`INSERT INTO ${quoteId(fx)}.${quoteId(t)} (${cols}) SELECT ${cols} FROM ${quoteId(lab)}.${quoteId(t)}`);
    }
    await c.query(
      `CREATE TABLE ${quoteId(fx)}.lab_meta_trigger AS
       SELECT TRIGGER_NAME AS trigger_name, EVENT_MANIPULATION AS event_manipulation, EVENT_OBJECT_TABLE AS event_object_table,
              ACTION_TIMING AS action_timing, ACTION_ORDER AS action_order, ACTION_STATEMENT AS action_statement
         FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=?`, [lab]);
    await c.query(
      `CREATE TABLE ${quoteId(fx)}.lab_meta_routine AS
       SELECT ROUTINE_NAME AS routine_name, ROUTINE_TYPE AS routine_type, DTD_IDENTIFIER AS returns_type,
              ROUTINE_DEFINITION AS routine_definition, IS_DETERMINISTIC AS is_deterministic,
              SQL_DATA_ACCESS AS sql_data_access, SECURITY_TYPE AS security_type
         FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=?`, [lab]);
    await c.query(
      `CREATE TABLE ${quoteId(fx)}.lab_meta_parameter AS
       SELECT SPECIFIC_NAME AS routine_name, ORDINAL_POSITION AS ordinal_position, PARAMETER_MODE AS parameter_mode,
              PARAMETER_NAME AS parameter_name, DTD_IDENTIFIER AS data_type
         FROM information_schema.PARAMETERS WHERE SPECIFIC_SCHEMA=? AND ORDINAL_POSITION > 0`, [lab]);
    await c.query(
      `CREATE TABLE ${quoteId(fx)}.lab_meta_view AS
       SELECT TABLE_NAME AS view_name, VIEW_DEFINITION AS view_definition
         FROM information_schema.VIEWS WHERE TABLE_SCHEMA=?`, [lab]);
    return tables;
  } finally {
    await c.end();
  }
}

/** Order in which trigger-guarded tables must be refilled (see resetLabSandbox). */
const GUARDED = new Set(["customer", "product", "sales_order", "order_line"]);

export interface ResetReport { tables: string[]; rows: number; elapsedMs: number }

/**
 * Restore every sandbox table from the fixture, using only DML (lab_operator).
 *
 * Triggers cannot be disabled without DDL, so the refill is ordered to satisfy them:
 *  - bi_order_line accepts lines only for DRAFT orders of ACTIVE products (finding F4), and
 *    bi_sales_order accepts orders only for ACTIVE customers;
 *  - so customers and products are inserted active, orders are inserted as draft, lines are added,
 *    the draft orders are deleted (foreign_key_checks=0 means no cascade) and re-inserted with
 *    their real status. No UPDATE of sales_order happens, so bu/au_sales_order never fire.
 * AUTO_INCREMENT counters are not rewound (that needs ALTER), so ids issued after a reset can differ.
 */
export async function resetLabSandbox(conn: Q, labDb: string, fixtureDb: string): Promise<ResetReport> {
  const t0 = Date.now();
  const L = (t: string) => `${quoteId(labDb)}.${quoteId(t)}`;
  const F = (t: string) => `${quoteId(fixtureDb)}.${quoteId(t)}`;
  const tables = (await baseTables(conn, fixtureDb)).filter((t) => !t.startsWith(META_PREFIX));
  if (tables.length === 0) throw new Error(`Lab fixture ${fixtureDb} is empty or missing: run pnpm db:setup or pnpm db:reset-lab`);
  const cols = new Map<string, string[]>();
  for (const t of tables) cols.set(t, await storedColumns(conn, fixtureDb, t));
  const list = (t: string) => cols.get(t)!.map(quoteId).join(",");
  const forced = (t: string, overrides: Record<string, string>) =>
    cols.get(t)!.map((c) => overrides[c] ?? quoteId(c)).join(",");
  let rows = 0;
  const ins = async (sql: string) => { const [r] = await conn.query(sql) as unknown as [{ affectedRows: number }]; rows += r.affectedRows ?? 0; };

  await conn.query("SET SESSION foreign_key_checks = 0");
  try {
    await conn.query("START TRANSACTION");
    try {
      for (const t of tables) await conn.query(`DELETE FROM ${L(t)}`);
      for (const t of tables) if (!GUARDED.has(t)) await ins(`INSERT INTO ${L(t)} (${list(t)}) SELECT ${list(t)} FROM ${F(t)}`);
      const has = (t: string) => cols.has(t);
      if (has("customer")) await ins(`INSERT INTO ${L("customer")} (${list("customer")}) SELECT ${forced("customer", { is_active: "TRUE" })} FROM ${F("customer")}`);
      if (has("product")) await ins(`INSERT INTO ${L("product")} (${list("product")}) SELECT ${forced("product", { is_active: "TRUE" })} FROM ${F("product")}`);
      if (has("sales_order")) {
        await conn.query(`INSERT INTO ${L("sales_order")} (${list("sales_order")}) SELECT ${forced("sales_order", { order_status: "'draft'" })} FROM ${F("sales_order")}`);
        if (has("order_line")) await ins(`INSERT INTO ${L("order_line")} (${list("order_line")}) SELECT ${list("order_line")} FROM ${F("order_line")}`);
        await conn.query(`DELETE FROM ${L("sales_order")}`);
        await ins(`INSERT INTO ${L("sales_order")} (${list("sales_order")}) SELECT ${list("sales_order")} FROM ${F("sales_order")}`);
      } else if (has("order_line")) {
        await ins(`INSERT INTO ${L("order_line")} (${list("order_line")}) SELECT ${list("order_line")} FROM ${F("order_line")}`);
      }
      if (has("customer")) await conn.query(`UPDATE ${L("customer")} c JOIN ${F("customer")} f ON f.customer_id = c.customer_id SET c.is_active = f.is_active`);
      // au_product logs only list_price changes, so restoring is_active writes no audit row.
      if (has("product")) await conn.query(`UPDATE ${L("product")} p JOIN ${F("product")} f ON f.product_id = p.product_id SET p.is_active = f.is_active`);
      await conn.query("COMMIT");
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => undefined);
      throw e;
    }
  } finally {
    await conn.query("SET SESSION foreign_key_checks = 1");
  }
  return { tables, rows, elapsedMs: Date.now() - t0 };
}
