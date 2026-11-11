import { createRequire } from "node:module";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, createPool, type Conn, type Pool } from "../../packages/database/src/connection.js";
import { REPO_ROOT } from "../../packages/database/src/runner.js";
import { classifySql, type SqlParserLike } from "../../packages/database/src/lab/classifier.js";
import { runReadOnlySql } from "../../packages/database/src/lab/executor.js";
import { LAB_QUERIES } from "../../packages/database/src/lab/queries.js";
import { expectSqlError, testCfg } from "./helpers.js";

// node-sql-parser is a dependency of the web app (the classifier takes the parser by injection).
const req = createRequire(join(REPO_ROOT, "apps/web/package.json"));
const { Parser } = req("node-sql-parser") as { Parser: new () => SqlParserLike };
const parser = new Parser();

const cfg = testCfg();
let reader: Pool, readerConn: Conn;
beforeAll(async () => {
  reader = createPool(cfg, "lab_reader", cfg.LAB_DB_NAME, 3);
  readerConn = await connect(cfg, "lab_reader", cfg.LAB_DB_NAME);
});
afterAll(async () => { await reader?.end(); await readerConn?.end(); });

describe("classifier (defence in depth)", () => {
  it.each([
    ["UPDATE product SET list_price = 1", "not_read_only"],
    ["DELETE FROM audit_log", "not_read_only"],
    ["INSERT INTO postal_area VALUES ('1','x','y')", "not_read_only"],
    ["DROP TABLE audit_log", "not_read_only"],
    ["CREATE TABLE x (a INT)", "not_read_only"],
    ["CALL sp_confirm_order(5004)", "not_read_only"],
    ["SET @a = 1", "not_read_only"],
    ["SELECT 1; SELECT 2", "multiple_statements"],
    ["SELECT 1; DELETE FROM audit_log", "multiple_statements"],
    ["SELECT * FROM product FOR UPDATE", "locking_read"],
    ["SELECT * FROM product LOCK IN SHARE MODE", "locking_read"],
    ["SELECT 1 INTO @x", "select_into"],
    ["SELECT GET_LOCK('x', 1)", "forbidden_function"],
    ["EXPLAIN ANALYZE SELECT 1", "explain_analyze"],
    ["", "empty"],
  ])("rejects %s", (sql, reason) => {
    const c = classifySql(sql, parser);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toBe(reason);
  });
  it.each([
    ["SELECT 1;", "select"], ["WITH t AS (SELECT 1 a) SELECT * FROM t", "with"], ["SHOW TABLES", "show"],
    ["DESCRIBE product", "describe"], ["EXPLAIN FORMAT=JSON SELECT * FROM product", "explain"],
  ])("accepts %s", (sql, kind) => {
    const c = classifySql(sql, parser);
    expect(c.ok && c.kind).toBe(kind);
  });
  it("every library example is accepted", () => {
    for (const q of LAB_QUERIES) expect(classifySql(q.sql, parser), q.id).toMatchObject({ ok: true });
  });
});

describe("read-only executor (lab_reader)", () => {
  it("MySQL itself denies lab_reader writes, whatever the classifier says", async () => {
    await expectSqlError(readerConn.query("UPDATE product SET list_price = 1"), /command denied/);
    await expectSqlError(readerConn.query("CALL sp_confirm_order(5004)"), /command denied/);
    await expectSqlError(readerConn.query(`SELECT * FROM ${cfg.APP_DB_NAME}.app_user`), /command denied/);
  });
  it("runs every library example and returns column metadata", async () => {
    for (const q of LAB_QUERIES) {
      const r = await runReadOnlySql(reader, q.sql, { parser });
      expect(r.ok, `${q.id}: ${r.ok ? "" : r.error.message}`).toBe(true);
      if (r.ok) { expect(r.columns.length).toBeGreaterThan(0); expect(r.rowCount).toBeGreaterThan(0); }
    }
  });
  it("caps rows and reports truncation", async () => {
    const r = await runReadOnlySql(reader, "SELECT * FROM information_schema.COLUMNS", { parser, rowLimit: 5 });
    expect(r).toMatchObject({ ok: true, rowCount: 5, truncated: true });
  });
  it("applies MAX_EXECUTION_TIME", async () => {
    const r = await runReadOnlySql(reader,
      "SELECT COUNT(*) FROM information_schema.COLUMNS a, information_schema.COLUMNS b, information_schema.COLUMNS c",
      { parser, maxExecutionMs: 300 });
    if (r.ok) expect(r.hitTimeLimit).toBe(true);
    else expect(r.error.errno).toBe(3024);
  });
  it("produces an EXPLAIN FORMAT=JSON plan, also over views", async () => {
    const r = await runReadOnlySql(reader, "SELECT * FROM vw_order_summary", { parser, mode: "explain" });
    expect(r.ok && r.plan?.format).toBe("json");
  });
  it("shows the real MySQL error", async () => {
    const r = await runReadOnlySql(reader, "SELECT no_such_column FROM product", { parser });
    expect(r).toMatchObject({ ok: false, stage: "execute", error: { code: "ER_BAD_FIELD_ERROR" } });
  });
});
