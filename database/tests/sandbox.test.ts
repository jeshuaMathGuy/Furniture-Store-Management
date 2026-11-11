import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, type Conn } from "../../packages/database/src/connection.js";
import { join } from "node:path";
import { ORIGINAL_TABLES, REPO_ROOT, applyMigrations, runSqlFile } from "../../packages/database/src/runner.js";
import { rebuildLab } from "../../packages/database/src/setup.js";
import { expectSqlError, fingerprint, q, scratchDb, testCfg } from "./helpers.js";

const cfg = testCfg();
let root: Conn, reader: Conn, operator: Conn, app: Conn;

beforeAll(async () => {
  root = await connect(cfg, "root");
  reader = await connect(cfg, "lab_reader");
  operator = await connect(cfg, "lab_operator");
  app = await connect(cfg, "app", cfg.APP_DB_NAME);
});
afterAll(async () => { await Promise.all([root, reader, operator, app].map((c) => c?.end())); });

const LAB = cfg.LAB_DB_NAME, APP = cfg.APP_DB_NAME, TEACH = cfg.TEACHING_DB_NAME;

describe("required test 17: sandbox isolation (privilege boundary)", () => {
  it("lab_reader can read the lab and teaching schemas and call the two functions", async () => {
    expect(await q(reader, `SELECT COUNT(*) n FROM ${LAB}.product`)).toEqual([{ n: 4 }]);
    expect(await q(reader, `SELECT COUNT(*) n FROM ${TEACH}.unf_sales_order`)).toEqual([{ n: 3 }]);
    expect(await q(reader, `SELECT ${LAB}.fn_discounted_price(100,10) v`)).toEqual([{ v: "90.00" }]);
  });
  it.each([
    ["INSERT", `INSERT INTO ${LAB}.postal_area VALUES ('1','x','y')`],
    ["UPDATE", `UPDATE ${LAB}.product SET list_price=1`],
    ["DELETE", `DELETE FROM ${LAB}.audit_log`],
    ["DROP", `DROP TABLE ${LAB}.audit_log`],
    ["CREATE", `CREATE TABLE ${LAB}.x (a INT)`],
    ["teaching write", `DELETE FROM ${TEACH}.unf_customer`],
  ])("lab_reader is denied %s", async (_l, sql) => {
    await expectSqlError(reader.query(sql), /command denied|Access denied/);
  });
  it("lab_reader cannot CALL procedures (they are SQL SECURITY DEFINER and would mutate)", async () => {
    await expectSqlError(reader.query(`CALL ${LAB}.sp_queue_reorders('2026-11-09', @q)`), /command denied/);
  });
  it("lab users have no access at all to the application database", async () => {
    await expectSqlError(reader.query(`SELECT * FROM ${APP}.customer`), /command denied/);
    await expectSqlError(operator.query(`SELECT * FROM ${APP}.customer`), /command denied/);
    await expectSqlError(operator.query(`UPDATE ${APP}.product SET list_price=1`), /command denied/);
  });
  it("lab_operator can run procedures in the lab only, and lab mutations never reach the app DB", async () => {
    const appBefore = await fingerprint(root, APP, ORIGINAL_TABLES);
    await operator.query(`CALL ${LAB}.sp_confirm_order(5004)`);
    expect(await q(operator, `SELECT order_status s FROM ${LAB}.sales_order WHERE order_id=5004`)).toEqual([{ s: "confirmed" }]);
    expect(await fingerprint(root, APP, ORIGINAL_TABLES)).toEqual(appBefore);
  });
  it("the application user cannot run DDL", async () => {
    await expectSqlError(app.query("CREATE TABLE x (a INT)"), /command denied/);
    await expectSqlError(app.query("DROP TABLE audit_log"), /command denied/);
    await expectSqlError(app.query("ALTER TABLE product ADD COLUMN x INT"), /command denied/);
  });
});

describe("required test 18: reset reproduces deterministic fixtures", () => {
  it("two rebuilds produce identical content (excluding wall-clock columns), matching a pristine replay", async () => {
    await rebuildLab(cfg);
    const first = await fingerprint(root, LAB, ORIGINAL_TABLES);
    await root.query(`UPDATE ${LAB}.product_inventory SET qty_on_hand=0`);
    await root.query(`DELETE FROM ${LAB}.feedback`);
    await rebuildLab(cfg);
    const second = await fingerprint(root, LAB, ORIGINAL_TABLES);
    expect(second).toEqual(first);
    const pristine = await scratchDb("pristine");
    try {
      expect(await fingerprint(root, pristine.dbName, ORIGINAL_TABLES)).toEqual(first);
    } finally {
      await pristine.dispose();
    }
  });
  it("grants survive a rebuild", async () => {
    const r2 = await connect(cfg, "lab_reader");
    try { expect(await q(r2, `SELECT ${LAB}.fn_warranty_expiry('2026-01-01',12) d`)).toEqual([{ d: "2027-01-01" }]); }
    finally { await r2.end(); }
  });
});

describe("original objects are unchanged by extension migrations (preservation)", () => {
  it("columns, constraints, indexes, routines and triggers match a pristine replay", async () => {
    const pristine = await scratchDb("invariance");
    const meta = async (schema: string) => ({
      columns: await q(root, `SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_DEFAULT,IS_NULLABLE,COLUMN_TYPE,COLUMN_KEY,EXTRA,GENERATION_EXPRESSION
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (?) ORDER BY TABLE_NAME, ORDINAL_POSITION`, [schema, ORIGINAL_TABLES]),
      constraints: await q(root, `SELECT TABLE_NAME,CONSTRAINT_NAME,CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (?) ORDER BY TABLE_NAME, CONSTRAINT_NAME`, [schema, ORIGINAL_TABLES]),
      checks: await q(root, `SELECT CONSTRAINT_NAME, CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA=? AND CONSTRAINT_NAME IN (SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (?)) ORDER BY 1`, [schema, schema, ORIGINAL_TABLES]),
      refs: await q(root, `SELECT CONSTRAINT_NAME,UPDATE_RULE,DELETE_RULE,REFERENCED_TABLE_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA=? AND TABLE_NAME IN (?) ORDER BY 1`, [schema, ORIGINAL_TABLES]),
      indexes: await q(root, `SELECT TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME,NON_UNIQUE FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (?) ORDER BY 1,2,3`, [schema, ORIGINAL_TABLES]),
      routines: await q(root, `SELECT ROUTINE_NAME,ROUTINE_TYPE,ROUTINE_DEFINITION,IS_DETERMINISTIC,SQL_DATA_ACCESS,SECURITY_TYPE
        FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=? ORDER BY 1`, [schema]),
      triggers: await q(root, `SELECT TRIGGER_NAME,EVENT_MANIPULATION,EVENT_OBJECT_TABLE,ACTION_TIMING,ACTION_STATEMENT
        FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=? ORDER BY 1`, [schema]),
    });
    try {
      const [a, b] = [await meta(pristine.dbName), await meta(APP)];
      expect(b).toEqual(a);
    } finally {
      await pristine.dispose();
    }
  });
  it("demo seeds add rows but never modify original rows", async () => {
    // Own database: the shared test app DB is mutated by other test files.
    const pristine = await scratchDb("seedcheck");
    const seeded = await scratchDb("seeded");
    try {
      await applyMigrations(cfg, seeded.dbName, "app");
      for (const f of ["0001_reference.sql", "0002_demo_catalog.sql", "0003_demo_addresses.sql"])
        await runSqlFile(cfg, seeded.dbName, join(REPO_ROOT, "database/seeds", f));
      const orig = await fingerprint(root, pristine.dbName, ORIGINAL_TABLES);
      const after = await fingerprint(root, seeded.dbName, ORIGINAL_TABLES);
      for (const t of ORIGINAL_TABLES) {
        for (const row of orig[t]!) expect(after[t], `${t} lost/changed an original row`).toContain(row);
      }
      const prov = await q(root, `SELECT source, COUNT(*) n FROM ${seeded.dbName}.data_provenance WHERE entity_name='product' GROUP BY source ORDER BY source`);
      expect(prov).toEqual([{ source: "original_sql", n: 4 }, { source: "demo_seed", n: 16 }]);
    } finally {
      await pristine.dispose();
      await seeded.dispose();
    }
  });
});
