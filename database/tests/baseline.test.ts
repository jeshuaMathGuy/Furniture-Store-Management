import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { splitSqlScript } from "../../packages/database/src/sql-splitter.js";
import {
  ORIGINAL_ROUTINES, ORIGINAL_SQL, ORIGINAL_TABLES, ORIGINAL_TRIGGERS, readOriginalSql,
} from "../../packages/database/src/runner.js";
import { q, scratchDb } from "./helpers.js";

let db: Awaited<ReturnType<typeof scratchDb>>;
beforeAll(async () => { db = await scratchDb("baseline"); });
afterAll(async () => { await db?.dispose(); });

const resultAt = (line: number) => db.reports.find((r) => r.line === line)?.rows;

describe("source preservation", () => {
  it("original file is byte-identical to the audited source (hash check)", () => {
    expect(() => readOriginalSql()).not.toThrow();
  });
  it("splitter yields every statement, including the 12 DELIMITER-bounded stored programs", () => {
    const stmts = splitSqlScript(readFileSync(ORIGINAL_SQL, "utf8"));
    expect(stmts).toHaveLength(149);
    expect(stmts.filter((s) => /^CREATE (PROCEDURE|TRIGGER|FUNCTION)/.test(s.sql))).toHaveLength(12);
    expect(stmts.some((s) => /DELIMITER/i.test(s.sql))).toBe(false);
  });
});

describe("required test 1: all original objects are created", () => {
  it("20 permanent tables, 0 views", async () => {
    const rows = await q(db.conn, "SELECT TABLE_NAME t, TABLE_TYPE k FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");
    expect(rows.filter((r) => r.k === "BASE TABLE").map((r) => r.t).sort()).toEqual([...ORIGINAL_TABLES].sort());
    expect(rows.filter((r) => r.k === "VIEW")).toHaveLength(0);
  });
  it("21 foreign keys, 14 CHECK constraints, 1 stored generated column", async () => {
    const [fk] = await q(db.conn, "SELECT COUNT(*) n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()");
    const [ck] = await q(db.conn, "SELECT COUNT(*) n FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()");
    const gen = await q(db.conn, "SELECT TABLE_NAME t, COLUMN_NAME c, EXTRA e FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND GENERATION_EXPRESSION <> ''");
    expect(Number(fk!.n)).toBe(21);
    expect(Number(ck!.n)).toBe(14);
    expect(gen).toEqual([{ t: "order_line", c: "line_total", e: "STORED GENERATED" }]);
  });
  it("5 procedures, 2 functions, 5 triggers", async () => {
    const routines = await q(db.conn, "SELECT ROUTINE_TYPE k, ROUTINE_NAME n FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE() ORDER BY n");
    expect(routines.filter((r) => r.k === "PROCEDURE").map((r) => r.n)).toEqual([...ORIGINAL_ROUTINES.PROCEDURE]);
    expect(routines.filter((r) => r.k === "FUNCTION").map((r) => r.n)).toEqual([...ORIGINAL_ROUTINES.FUNCTION]);
    const triggers = await q(db.conn, "SELECT TRIGGER_NAME n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY n");
    expect(triggers.map((r) => r.n)).toEqual([...ORIGINAL_TRIGGERS]);
  });
});

describe("script results match hand-derived expectations (audit section 5)", () => {
  it("procedure OUT values", () => {
    expect(resultAt(855)).toEqual([{ awarded_points: 1020, total_supplier_settlements: "102000.00", reorder_requests_processed: 1 }]);
  });
  it("function outputs", () => {
    expect(resultAt(859)).toEqual([{ discounted_price: "40500.00", warranty_expiry: "2029-11-04" }]);
  });
  it("order totals from the generated line_total column", () => {
    expect(resultAt(862)!.map((r) => [r.order_id, r.calculated_order_total])).toEqual([
      [5001, "67000.00"], [5002, "65000.00"], [5003, "37000.00"], [5004, "45000.00"]]);
  });
  it("every verification query reports 0, except the order-of-operations artefact F2", () => {
    const verifications = db.reports.flatMap((r) => (r.rows ?? []).filter((x) => "verification" in x));
    const byName = Object.fromEntries(verifications.map((v) => [v.verification, Number(v.violations)]));
    expect(byName).toEqual({
      unf_to_nf1_expansion: 0, nf1_to_nf2_lossless: 0,
      nf2_to_3nf_order_lossless: 1, // F2: compares pre-confirmation nf2_order with post-confirmation sales_order
      nf2_to_3nf_product_lossless: 0, nf2_order_line_reconstruction: 0,
      "3nf_to_bcnf_lossless": 0, "3nf_to_bcnf_extra_rows": 0, "4nf_lossless_reconstruction": 0,
      functional_dependency_consistency: 0, foreign_key_integrity: 0,
    });
  });
  it("F2 is caused by order 5001's status change, not by a lossy decomposition", async () => {
    const [o] = await q(db.conn, "SELECT order_status FROM sales_order WHERE order_id=5001");
    expect(o!.order_status).toBe("confirmed");
  });
  it("final operational state", async () => {
    expect(await q(db.conn, "SELECT product_id, qty_on_hand FROM product_inventory ORDER BY product_id")).toEqual([
      { product_id: 101, qty_on_hand: 12 }, { product_id: 102, qty_on_hand: 1 },
      { product_id: 201, qty_on_hand: 6 }, { product_id: 202, qty_on_hand: 10 }]);
    expect(await q(db.conn, "SELECT order_id, order_status FROM sales_order ORDER BY order_id")).toEqual([
      { order_id: 5001, order_status: "confirmed" }, { order_id: 5002, order_status: "delivered" },
      { order_id: 5003, order_status: "delivered" }, { order_id: 5004, order_status: "placed" }]);
    expect(await q(db.conn, "SELECT entity_name, entity_key, old_value, new_value FROM audit_log ORDER BY audit_id")).toEqual([
      { entity_name: "sales_order", entity_key: "5004", old_value: "draft", new_value: "placed" },
      { entity_name: "product", entity_key: "101", old_value: "45000.00", new_value: "45001.00" },
      { entity_name: "product", entity_key: "101", old_value: "45001.00", new_value: "45000.00" },
      { entity_name: "sales_order", entity_key: "5001", old_value: "placed", new_value: "confirmed" }]);
    const [h] = await q(db.conn, "SELECT COUNT(*) n FROM order_status_history");
    expect(Number(h!.n)).toBe(5); // F11: 3 imported + 5004 placed + 5001 confirmed
    expect(await q(db.conn, "SELECT product_id, requested_qty, request_status FROM reorder_request")).toEqual([
      { product_id: 102, requested_qty: 12, request_status: "open" }]);
    expect(await q(db.conn, "SELECT receipt_status FROM goods_receipt WHERE receipt_id=7001")).toEqual([{ receipt_status: "posted" }]);
  });
  it("trailing transaction demos leave no change (savepoint/rollback)", async () => {
    const [p] = await q(db.conn, "SELECT list_price FROM product WHERE product_id=102");
    expect(p!.list_price).toBe("12000.00");
  });
});

describe("required test 2: foreign-key integrity", () => {
  it("no orphan rows for any declared FK", async () => {
    const fks = await q(db.conn, `SELECT k.TABLE_NAME t, k.COLUMN_NAME c, k.REFERENCED_TABLE_NAME rt, k.REFERENCED_COLUMN_NAME rc
      FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL`);
    expect(fks.length).toBe(21);
    for (const fk of fks) {
      const [r] = await q(db.conn, `SELECT COUNT(*) n FROM \`${fk.t}\` x LEFT JOIN \`${fk.rt}\` y ON y.\`${fk.rc}\` = x.\`${fk.c}\`
        WHERE x.\`${fk.c}\` IS NOT NULL AND y.\`${fk.rc}\` IS NULL`);
      expect(Number(r!.n), `${fk.t}.${fk.c} → ${fk.rt}`).toBe(0);
    }
  });
});
