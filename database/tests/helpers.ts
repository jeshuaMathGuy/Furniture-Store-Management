import type { RowDataPacket } from "mysql2";
import { loadConfig } from "../../packages/database/src/config.js";
import { connect, createPool, quoteId, type Conn } from "../../packages/database/src/connection.js";
import { applyMigrations, runOriginal, type StatementReport } from "../../packages/database/src/runner.js";
import type { AuthContext } from "../../packages/database/src/auth/authorize.js";

/** Test runs use their own schemas so a developer's application data is never touched. */
/** Override with FURNI_TEST_PREFIX so parallel test runs never share schemas. */
export const TEST_PREFIX = process.env.FURNI_TEST_PREFIX ?? "furni_test";
export const testCfg = () =>
  loadConfig({ APP_DB_NAME: `${TEST_PREFIX}_app`, LAB_DB_NAME: `${TEST_PREFIX}_lab`, TEACHING_DB_NAME: `${TEST_PREFIX}_teaching` });

export type Rows = Record<string, any>[];

export async function q(conn: { query: Conn["query"] }, sql: string, params?: unknown[]): Promise<Rows> {
  const [rows] = await conn.query<RowDataPacket[]>(sql, params);
  return rows as Rows;
}

/**
 * A private database built by replaying the ORIGINAL script unchanged
 * (optionally plus lab-targeted views). Returns a root session bound to it.
 */
export async function scratchDb(name: string, opts: { views?: boolean } = {}) {
  const cfg = testCfg();
  const dbName = `${TEST_PREFIX}_t_${name}`.slice(0, 64);
  const reports: StatementReport[] = await runOriginal(cfg, { dbName });
  if (opts.views) await applyMigrations(cfg, dbName, "lab");
  const conn = await connect(cfg, "root", dbName);
  const pool = createPool(cfg, "root", dbName, 5);
  return {
    cfg, dbName, conn, pool, reports,
    async dispose() {
      await pool.end();
      await conn.query(`DROP DATABASE IF EXISTS ${quoteId(dbName)}`);
      await conn.end();
    },
  };
}

export async function expectSqlError(p: Promise<unknown>, message: RegExp | string): Promise<any> {
  try { await p; } catch (e: any) {
    const text: string = e.sqlMessage ?? e.message;
    if (typeof message === "string" ? !text.includes(message) : !message.test(text))
      throw new Error(`Expected error matching ${message}, got: ${text}`);
    return e;
  }
  throw new Error(`Expected an error matching ${message}, but the statement succeeded`);
}

export const ctxWith = (roles: AuthContext["roles"], extra: Partial<AuthContext> = {}): AuthContext => ({
  userId: 0, email: "test@local", displayName: "test", roles, customerId: null, supplierIds: [], ...extra,
});

/** Columns whose values come from CURRENT_TIMESTAMP and therefore differ between runs (audit F7). */
export const VOLATILE_COLUMNS = new Set(["changed_at", "event_time", "awarded_at", "generated_at"]);

/** Order-independent content of tables, excluding wall-clock columns. */
export async function fingerprint(conn: Conn, schema: string, tables: readonly string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const t of tables) {
    const rows = await q(conn, `SELECT * FROM ${quoteId(schema)}.${quoteId(t)}`);
    out[t] = rows
      .map((r) => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !VOLATILE_COLUMNS.has(k)))))
      .sort();
  }
  return out;
}
