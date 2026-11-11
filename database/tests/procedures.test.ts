import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectSqlError, q, scratchDb } from "./helpers.js";

let db: Awaited<ReturnType<typeof scratchDb>>;
beforeAll(async () => { db = await scratchDb("procs"); });
afterAll(async () => { await db?.dispose(); });

const inv = async (id: number) => Number((await q(db.conn, "SELECT qty_on_hand FROM product_inventory WHERE product_id=?", [id]))[0]!.qty_on_hand);
const status = async (id: number) => (await q(db.conn, "SELECT order_status FROM sales_order WHERE order_id=?", [id]))[0]?.order_status;

/** Correct order-creation path given trigger bi_order_line (audit F4): draft → lines → placed. */
async function placeOrder(orderId: number, lines: [productId: number, qty: number][], customerId = 1) {
  await db.conn.query("INSERT INTO sales_order (order_id, customer_id, order_date, order_status) VALUES (?,?,'2026-11-05 10:00:00','draft')", [orderId, customerId]);
  for (const [p, n] of lines) await db.conn.query("INSERT INTO order_line (order_id, product_id, quantity, unit_price) VALUES (?,?,?,1000)", [orderId, p, n]);
  await db.conn.query("UPDATE sales_order SET order_status='placed' WHERE order_id=?", [orderId]);
}

describe("sp_confirm_order (required tests 5, 9, 10)", () => {
  it("confirms a placed order, deducts stock, and fires history + audit triggers", async () => {
    const before = await inv(101);
    const [{ n: auditBefore }] = await q(db.conn, "SELECT COUNT(*) n FROM audit_log") as any;
    await db.conn.query("CALL sp_confirm_order(5004)");
    expect(await status(5004)).toBe("confirmed");
    expect(await inv(101)).toBe(before - 1);
    const hist = await q(db.conn, "SELECT order_status FROM order_status_history WHERE order_id=5004 ORDER BY history_id");
    expect(hist.map((h) => h.order_status)).toEqual(["placed", "confirmed"]);
    const [{ n: auditAfter }] = await q(db.conn, "SELECT COUNT(*) n FROM audit_log") as any;
    expect(Number(auditAfter) - Number(auditBefore)).toBe(1);
  });
  it("rejects a missing order", async () => {
    await expectSqlError(db.conn.query("CALL sp_confirm_order(9999)"), "Order does not exist or is not in placed status");
  });
  it("rejects an order in the wrong status", async () => {
    await expectSqlError(db.conn.query("CALL sp_confirm_order(5002)"), "not in placed status");
  });
  it("rejects an empty order", async () => {
    await placeOrder(6001, []);
    await expectSqlError(db.conn.query("CALL sp_confirm_order(6001)"), "Order has no line items");
    expect(await status(6001)).toBe("placed");
  });
  it("insufficient stock on a later line rolls back the earlier line's deduction", async () => {
    const s101 = await inv(101), s201 = await inv(201);
    await placeOrder(6002, [[101, 1], [201, s201 + 1]]); // cursor deducts 101 first, then fails on 201
    await expectSqlError(db.conn.query("CALL sp_confirm_order(6002)"), "Insufficient inventory or missing inventory record");
    expect(await inv(101)).toBe(s101);
    expect(await inv(201)).toBe(s201);
    expect(await status(6002)).toBe("placed");
    const [neg] = await q(db.conn, "SELECT COUNT(*) n FROM product_inventory WHERE qty_on_hand < 0");
    expect(Number(neg!.n)).toBe(0);
  });
  it("missing inventory record fails and rolls back", async () => {
    await db.conn.query("INSERT INTO product (product_id, product_name, supplier_id, list_price) VALUES (999,'No-stock stool',10,1000)");
    await placeOrder(6003, [[999, 1]]);
    await expectSqlError(db.conn.query("CALL sp_confirm_order(6003)"), "missing inventory record");
    expect(await status(6003)).toBe("placed");
  });
});

describe("sp_receive_goods (required test 11)", () => {
  it("posting an already posted receipt is rejected", async () => {
    await expectSqlError(db.conn.query("CALL sp_receive_goods(7001)"), "Receipt does not exist or has already been posted");
  });
  it("posts a pending receipt exactly once", async () => {
    const before = await inv(202);
    await db.conn.query("INSERT INTO goods_receipt VALUES (7002,'2026-11-06','pending')");
    await db.conn.query("INSERT INTO goods_receipt_line VALUES (7002,202,3)");
    await db.conn.query("CALL sp_receive_goods(7002)");
    expect(await inv(202)).toBe(before + 3);
    await expectSqlError(db.conn.query("CALL sp_receive_goods(7002)"), "already been posted");
    expect(await inv(202)).toBe(before + 3);
  });
  it("an empty receipt is rejected", async () => {
    await db.conn.query("INSERT INTO goods_receipt VALUES (7003,'2026-11-06','pending')");
    await expectSqlError(db.conn.query("CALL sp_receive_goods(7003)"), "Receipt contains no products");
  });
  it("a product without inventory rolls back the whole receipt", async () => {
    const before = await inv(101);
    await db.conn.query("INSERT INTO goods_receipt VALUES (7004,'2026-11-06','pending')");
    await db.conn.query("INSERT INTO goods_receipt_line VALUES (7004,101,2),(7004,999,1)");
    await expectSqlError(db.conn.query("CALL sp_receive_goods(7004)"), "Inventory record missing");
    expect(await inv(101)).toBe(before);
    expect((await q(db.conn, "SELECT receipt_status FROM goods_receipt WHERE receipt_id=7004"))[0]!.receipt_status).toBe("pending");
  });
});

describe("sp_award_loyalty (required test 12)", () => {
  it("a repeat call awards nothing and creates no duplicates", async () => {
    await db.conn.query("CALL sp_award_loyalty('2026-11-04', @p)");
    expect((await q(db.conn, "SELECT @p p"))[0]!.p).toBe(0);
    expect(await q(db.conn, "SELECT order_id, points_awarded FROM loyalty_award ORDER BY order_id")).toEqual([
      { order_id: 5002, points_awarded: 650 }, { order_id: 5003, points_awarded: 370 }]);
  });
  it("newly delivered orders are awarded FLOOR(total/100)", async () => {
    await db.conn.query("UPDATE sales_order SET order_status='shipped' WHERE order_id=5001");
    await db.conn.query("UPDATE sales_order SET order_status='delivered' WHERE order_id=5001");
    await db.conn.query("CALL sp_award_loyalty('2026-11-30', @p)");
    expect((await q(db.conn, "SELECT @p p"))[0]!.p).toBe(670); // 67000.00 / 100
  });
  it("NULL cutoff is rejected", async () => {
    await expectSqlError(db.conn.query("CALL sp_award_loyalty(NULL, @p)"), "Cutoff date is required");
  });
});

describe("sp_build_supplier_settlements (required test 13)", () => {
  it("upserts one row per supplier and period; a re-run updates and does not duplicate", async () => {
    await db.conn.query("CALL sp_build_supplier_settlements('2026-11-01','2026-11-04', @t)");
    // 5001 is now delivered too (previous block): supplier 10 = 67000, supplier 20 = 102000
    expect((await q(db.conn, "SELECT @t t"))[0]!.t).toBe("169000.00");
    const rows = await q(db.conn, "SELECT supplier_id, settlement_amount FROM supplier_settlement WHERE period_start='2026-11-01' AND period_end='2026-11-04' ORDER BY supplier_id");
    expect(rows).toEqual([{ supplier_id: 10, settlement_amount: "67000.00" }, { supplier_id: 20, settlement_amount: "102000.00" }]);
    await db.conn.query("CALL sp_build_supplier_settlements('2026-11-01','2026-11-04', @t)");
    const [n] = await q(db.conn, "SELECT COUNT(*) n FROM supplier_settlement WHERE period_start='2026-11-01' AND period_end='2026-11-04'");
    expect(Number(n!.n)).toBe(2);
  });
  it("an invalid period is rejected", async () => {
    await expectSqlError(db.conn.query("CALL sp_build_supplier_settlements('2026-11-05','2026-11-01', @t)"), "Invalid settlement period");
  });
});

describe("sp_queue_reorders (required test 14)", () => {
  it("re-running for the same date updates the unique (product, date) row and inserts no duplicate", async () => {
    await db.conn.query("CALL sp_queue_reorders('2026-11-07', @q)");
    const first = await q(db.conn, "SELECT product_id, requested_qty FROM reorder_request WHERE request_date='2026-11-07' ORDER BY product_id");
    await db.conn.query("CALL sp_queue_reorders('2026-11-07', @q)");
    const second = await q(db.conn, "SELECT product_id, requested_qty FROM reorder_request WHERE request_date='2026-11-07' ORDER BY product_id");
    expect(second).toEqual(first);
    expect(Number((await q(db.conn, "SELECT @q q"))[0]!.q)).toBe(first.length); // F13: counts processed products
    const expected = await q(db.conn, "SELECT product_id, GREATEST(reorder_qty, reorder_point-qty_on_hand) requested_qty FROM product_inventory WHERE qty_on_hand<=reorder_point ORDER BY product_id");
    expect(first).toEqual(expected);
  });
});

describe("functions (required test 7)", () => {
  it("fn_discounted_price", async () => {
    const [r] = await q(db.conn, "SELECT fn_discounted_price(45000,10) a, fn_discounted_price(999.99,12.5) b, fn_discounted_price(100,0) c, fn_discounted_price(100,100) d, fn_discounted_price(NULL,5) e, fn_discounted_price(100,NULL) f, fn_discounted_price(-1,5) g, fn_discounted_price(100,100.01) h");
    expect(r).toEqual({ a: "40500.00", b: "874.99", c: "100.00", d: "0.00", e: null, f: null, g: null, h: null });
  });
  it("fn_warranty_expiry (month-end clamping, bounds)", async () => {
    const [r] = await q(db.conn, "SELECT fn_warranty_expiry('2026-11-04',36) a, fn_warranty_expiry('2026-01-31',1) b, fn_warranty_expiry('2028-02-29',12) c, fn_warranty_expiry('2026-01-01',0) d, fn_warranty_expiry('2026-01-01',120) e, fn_warranty_expiry('2026-01-01',121) f, fn_warranty_expiry('2026-01-01',-1) g, fn_warranty_expiry(NULL,12) h");
    expect(r).toEqual({ a: "2029-11-04", b: "2026-02-28", c: "2029-02-28", d: "2026-01-01", e: "2036-01-01", f: null, g: null, h: null });
  });
});
