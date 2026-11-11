import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectSqlError, q, scratchDb } from "./helpers.js";

let db: Awaited<ReturnType<typeof scratchDb>>;
beforeAll(async () => { db = await scratchDb("triggers"); });
afterAll(async () => { await db?.dispose(); });

const exec = (sql: string, p?: unknown[]) => db.conn.query(sql, p);
const setStatus = (id: number, s: string) => exec("UPDATE sales_order SET order_status=? WHERE order_id=?", [s, id]);
const newDraft = (id: number, customer = 1) =>
  exec("INSERT INTO sales_order (order_id, customer_id, order_date, order_status) VALUES (?,?,'2026-11-05 09:00:00','draft')", [id, customer]);

describe("bi_sales_order", () => {
  it("rejects orders for an inactive customer", async () => {
    await exec("UPDATE customer SET is_active=FALSE WHERE customer_id=3");
    await expectSqlError(newDraft(8001, 3), "Orders require an active customer");
    await exec("UPDATE customer SET is_active=TRUE WHERE customer_id=3");
  });
  it("rejects orders for a missing customer before the FK is consulted", async () => {
    await expectSqlError(newDraft(8002, 77), "Orders require an active customer");
  });
});

describe("bi_order_line", () => {
  it("lines may only be added to draft orders", async () => {
    await expectSqlError(exec("INSERT INTO order_line (order_id, product_id, quantity, unit_price) VALUES (5004,202,1,100)"),
      "Order lines can only be added to draft orders");
  });
  it("lines require an active product", async () => {
    await newDraft(8003);
    await exec("UPDATE product SET is_active=FALSE WHERE product_id=202");
    await expectSqlError(exec("INSERT INTO order_line (order_id, product_id, quantity, unit_price) VALUES (8003,202,1,100)"),
      "Order lines require an active product");
    await exec("UPDATE product SET is_active=TRUE WHERE product_id=202");
  });
});

let nextId = 8100;
describe("bu_sales_order / au_sales_order (required test 8)", () => {
  it("the full forward chain is accepted and each step writes one history and one audit row", async () => {
    await newDraft(8010);
    await exec("INSERT INTO order_line (order_id, product_id, quantity, unit_price) VALUES (8010,202,1,100)");
    for (const s of ["placed", "confirmed", "shipped", "delivered"]) await setStatus(8010, s);
    const hist = await q(db.conn, "SELECT order_status FROM order_status_history WHERE order_id=8010 ORDER BY history_id");
    expect(hist.map((h) => h.order_status)).toEqual(["placed", "confirmed", "shipped", "delivered"]);
    const audit = await q(db.conn, "SELECT old_value, new_value FROM audit_log WHERE entity_name='sales_order' AND entity_key='8010' ORDER BY audit_id");
    expect(audit).toEqual([
      { old_value: "draft", new_value: "placed" }, { old_value: "placed", new_value: "confirmed" },
      { old_value: "confirmed", new_value: "shipped" }, { old_value: "shipped", new_value: "delivered" }]);
  });
  it.each([
    ["draft", "confirmed"], ["draft", "shipped"], ["placed", "shipped"], ["placed", "delivered"],
    ["shipped", "cancelled"], ["delivered", "placed"], ["cancelled", "placed"],
  ])("rejects %s → %s and writes nothing", async (from, to) => {
    const id = nextId++;
    await newDraft(id);
    const path: Record<string, string[]> = {
      draft: [], placed: ["placed"], shipped: ["placed", "confirmed", "shipped"],
      delivered: ["placed", "confirmed", "shipped", "delivered"], cancelled: ["cancelled"],
    };
    for (const s of path[from]!) await setStatus(id, s);
    const [{ n: before }] = await q(db.conn, "SELECT COUNT(*) n FROM audit_log") as any;
    await expectSqlError(setStatus(id, to), "Invalid order status transition");
    const [{ n: after }] = await q(db.conn, "SELECT COUNT(*) n FROM audit_log") as any;
    expect(after).toBe(before);
    await exec("DELETE FROM sales_order WHERE order_id=?", [id]);
  });
  it.each([["draft"], ["placed"], ["confirmed"]])("allows cancellation from %s", async (from) => {
    const id = 8900 + ["draft", "placed", "confirmed"].indexOf(from);
    await newDraft(id);
    for (const s of ["placed", "confirmed"].slice(0, ["draft", "placed", "confirmed"].indexOf(from))) await setStatus(id, s);
    await setStatus(id, "cancelled");
    expect((await q(db.conn, "SELECT order_status FROM sales_order WHERE order_id=?", [id]))[0]!.order_status).toBe("cancelled");
  });
  it("an update that keeps the status writes no history or audit", async () => {
    const [{ n: before }] = await q(db.conn, "SELECT COUNT(*) n FROM order_status_history") as any;
    await exec("UPDATE sales_order SET order_date = order_date WHERE order_id=5002");
    const [{ n: after }] = await q(db.conn, "SELECT COUNT(*) n FROM order_status_history") as any;
    expect(after).toBe(before);
  });
});

describe("au_product", () => {
  it("audits list_price changes only", async () => {
    const [{ n: before }] = await q(db.conn, "SELECT COUNT(*) n FROM audit_log WHERE entity_name='product'") as any;
    await exec("UPDATE product SET product_name='Ergonomic Oak Chair II' WHERE product_id=102");
    await exec("UPDATE product SET list_price=12500 WHERE product_id=102");
    const rows = await q(db.conn, "SELECT entity_key, event_type, old_value, new_value FROM audit_log WHERE entity_name='product' ORDER BY audit_id");
    expect(rows.length - Number(before)).toBe(1);
    expect(rows.at(-1)).toEqual({ entity_key: "102", event_type: "price", old_value: "12000.00", new_value: "12500.00" });
  });
});

describe("integrity constraints (required test 15 and inspector cases)", () => {
  it("line_total is generated correctly, including discount", async () => {
    await newDraft(8500);
    await exec("INSERT INTO order_line (order_id, product_id, quantity, unit_price, discount_pct) VALUES (8500,201,3,999.99,12.5)");
    const [r] = await q(db.conn, "SELECT line_total, ROUND(3*999.99*(1-12.5/100),2) expected FROM order_line WHERE order_id=8500");
    expect(r!.line_total).toBe("2624.97");
    expect(Number(r!.line_total)).toBe(Number(r!.expected));
    await expectSqlError(exec("UPDATE order_line SET line_total=1 WHERE order_id=8500"), /generated column/i);
  });
  it.each([
    ["negative list price", "UPDATE product SET list_price=-1 WHERE product_id=101", "chk_product_price"],
    ["zero quantity", "INSERT INTO order_line (order_id, product_id, quantity, unit_price) VALUES (8500,202,0,1)", "chk_line_quantity"],
    ["discount > 100", "INSERT INTO order_line (order_id, product_id, quantity, unit_price, discount_pct) VALUES (8500,202,1,1,101)", "chk_line_discount"],
    ["rating 6", "INSERT INTO feedback (feedback_id, customer_id, product_id, rating) VALUES (99,1,102,6)", "chk_feedback_rating"],
    ["offer end before start", "INSERT INTO offer VALUES (99,101,'x',5,'2026-12-01','2026-11-01',TRUE)", "chk_offer_dates"],
    ["warranty 121 months", "INSERT INTO warranty_plan VALUES ('X121',10,121)", "chk_warranty_months"],
    ["negative inventory", "UPDATE product_inventory SET qty_on_hand=-1 WHERE product_id=101", "chk_inventory_values"],
  ])("CHECK rejects %s", async (_label, sql, constraint) => {
    await expectSqlError(exec(sql), constraint);
  });
  it("FK, UNIQUE and RESTRICT actions are enforced", async () => {
    await expectSqlError(exec("INSERT INTO product (product_id, product_name, supplier_id, list_price) VALUES (990,'x',77,1)"), "fk_product_supplier");
    await expectSqlError(exec("INSERT INTO customer VALUES (9,'Dup','asha.rao@example.com','560001',TRUE)"), /Duplicate entry/);
    await expectSqlError(exec("DELETE FROM supplier WHERE supplier_id=10"), /foreign key constraint fails/);
    await expectSqlError(exec("INSERT INTO feedback (feedback_id, customer_id, product_id, rating) VALUES (98,1,101,3)"), "uq_customer_product_feedback");
  });
  it("ON DELETE CASCADE removes an order's lines, plans and history", async () => {
    await exec("DELETE FROM sales_order WHERE order_id=8500");
    const [r] = await q(db.conn, "SELECT (SELECT COUNT(*) FROM order_line WHERE order_id=8500) l, (SELECT COUNT(*) FROM order_status_history WHERE order_id=8500) h");
    expect(r).toEqual({ l: 0, h: 0 });
  });
});
