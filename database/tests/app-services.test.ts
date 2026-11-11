import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Pool } from "../../packages/database/src/connection.js";
import { hashPassword, verifyPassword } from "../../packages/database/src/auth/password.js";
import { AuthError, login, logout, resolveSession, verifyCsrf } from "../../packages/database/src/auth/session.js";
import { ForbiddenError, assertSupplierScope } from "../../packages/database/src/auth/authorize.js";
import { listProducts } from "../../packages/database/src/repositories/catalog.js";
import { confirmOrder, getOrder, listOrdersForCustomer, transitionOrder } from "../../packages/database/src/repositories/orders.js";
import { lowStock } from "../../packages/database/src/repositories/inventory.js";
import { DomainError } from "../../packages/database/src/errors.js";
import { diffSnapshots, snapshotTable } from "../../packages/database/src/snapshot.js";
import { ctxWith, q, testCfg } from "./helpers.js";

const cfg = testCfg();
let pool: Pool; // connects as the least-privilege furni_app user
beforeAll(() => { pool = createPool(cfg, "app", cfg.APP_DB_NAME); });
afterAll(async () => { await pool?.end(); });

const pw = cfg.DEMO_ACCOUNT_PASSWORD;

describe("passwords and sessions", () => {
  it("scrypt hashes verify, reject wrong passwords, and are salted", async () => {
    const h1 = await hashPassword("correct horse"), h2 = await hashPassword("correct horse");
    expect(h1).not.toBe(h2);
    expect(await verifyPassword("correct horse", h1)).toBe(true);
    expect(await verifyPassword("wrong horse", h1)).toBe(false);
  });
  it("login issues a session that resolves to the mapped customer; logout revokes it", async () => {
    const s = await login(pool, "Asha.Rao@example.com", pw);
    expect(s.context).toMatchObject({ roles: ["customer"], customerId: 1 });
    expect((await resolveSession(pool, s.token))?.userId).toBe(s.context.userId);
    expect(await verifyCsrf(pool, s.token, s.csrfToken)).toBe(true);
    expect(await verifyCsrf(pool, s.token, "forged")).toBe(false);
    await logout(pool, s.token);
    expect(await resolveSession(pool, s.token)).toBeNull();
  });
  it("wrong password and unknown user fail identically", async () => {
    await expect(login(pool, "asha.rao@example.com", "nope-nope")).rejects.toBeInstanceOf(AuthError);
    await expect(login(pool, "ghost@example.com", pw)).rejects.toBeInstanceOf(AuthError);
  });
  it("only the session digest is stored, never the token", async () => {
    const s = await login(pool, "student@furniform.local", pw);
    const rows = await q(pool, "SELECT session_hash FROM app_session WHERE session_hash = ?", [s.token]);
    expect(rows).toHaveLength(0);
  });
});

describe("required test 20: role-based authorization", () => {
  it("a customer sees their own orders but not another customer's", async () => {
    const asha = (await login(pool, "asha.rao@example.com", pw)).context;
    expect((await listOrdersForCustomer(pool, asha, 1)).map((o) => o.orderId).sort()).toEqual([5001, 5004]);
    await expect(listOrdersForCustomer(pool, asha, 2)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getOrder(pool, asha, 5002)).rejects.toThrow("Order not found");
    expect((await getOrder(pool, asha, 5001)).lines).toHaveLength(2);
  });
  it("administrators can read any order; anonymous callers cannot", async () => {
    const admin = (await login(pool, "admin@furniform.local", pw)).context;
    expect(await listOrdersForCustomer(pool, admin, 2)).toHaveLength(1);
    await expect(listOrdersForCustomer(pool, null, 1)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("students and customers cannot confirm orders; warehouse can", async () => {
    const student = (await login(pool, "student@furniform.local", pw)).context;
    const customer = (await login(pool, "dev.shah@example.com", pw)).context;
    await expect(confirmOrder(pool, student, 5004)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(confirmOrder(pool, customer, 5004)).rejects.toBeInstanceOf(ForbiddenError);
    const wh = (await login(pool, "warehouse@furniform.local", pw)).context;
    await confirmOrder(pool, wh, 5004);
    expect((await getOrder(pool, wh, 5004)).status).toBe("confirmed");
  });
  it("supplier accounts are scoped to their own supplier", async () => {
    const cedar = (await login(pool, "cedarworks@furniform.local", pw)).context;
    expect(cedar.supplierIds).toEqual([10]);
    expect(() => assertSupplierScope(cedar, 10)).not.toThrow();
    expect(() => assertSupplierScope(cedar, 20)).toThrow(ForbiddenError);
  });
  it("trigger and procedure errors surface as DomainErrors with MySQL's own message", async () => {
    const admin = ctxWith(["administrator"]);
    await expect(transitionOrder(pool, admin, 5002, "placed")).rejects.toThrow("Invalid order status transition");
    await expect(confirmOrder(pool, admin, 5002)).rejects.toBeInstanceOf(DomainError);
  });
});

describe("catalog repository", () => {
  const asOf = "2026-11-10";
  it("lists the 4 original + 16 demo products with provenance", async () => {
    const all = await listProducts(pool, { asOf });
    expect(all).toHaveLength(20);
    expect(all.filter((p) => p.provenance === "original_sql").map((p) => p.productId).sort()).toEqual([101, 102, 201, 202]);
  });
  it("prices offers with fn_discounted_price as of a fixed date", async () => {
    const all = await listProducts(pool, { asOf });
    expect(all.find((p) => p.productId === 101)).toMatchObject({ offerPrice: "40500.00", offerName: "Executive Desk Launch" });
    const later = await listProducts(pool, { asOf: "2026-11-16" });
    expect(later.find((p) => p.productId === 201)?.offerPrice).toBeNull(); // Living Room Refresh ended 11-15
  });
  it("filters by category, supplier, price and keyword; sorts by price", async () => {
    const office = await listProducts(pool, { asOf, category: "office" });
    expect(office.every((p) => p.category === "office")).toBe(true);
    const urban = await listProducts(pool, { asOf, supplierId: 20 });
    expect(new Set(urban.map((p) => p.supplierName))).toEqual(new Set(["UrbanNest"]));
    const cheap = await listProducts(pool, { asOf, maxPrice: 15000, sort: "price_asc" });
    const prices = cheap.map((p) => Number(p.offerPrice ?? p.listPrice));
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(prices.every((x) => x <= 15000)).toBe(true);
    expect((await listProducts(pool, { asOf, q: "oak" })).length).toBeGreaterThan(0);
  });
  it("rejects malformed filters", async () => {
    await expect(listProducts(pool, { asOf: "tomorrow" })).rejects.toThrow();
  });
});

describe("required test 16: views agree with their definitions", () => {
  it("vw_order_summary totals equal SUM(line_total)", async () => {
    const v = await q(pool, "SELECT order_id, order_total FROM vw_order_summary ORDER BY order_id");
    const d = await q(pool, "SELECT order_id, COALESCE(ROUND(SUM(line_total),2),0) order_total FROM sales_order LEFT JOIN order_line USING (order_id) GROUP BY order_id ORDER BY order_id");
    expect(v.map((x) => [x.order_id, String(x.order_total)])).toEqual(d.map((x) => [x.order_id, String(x.order_total)]));
  });
  it("vw_customer_loyalty and vw_supplier_performance", async () => {
    // Compare the view with its definition (other test files may award more points first).
    const view = await q(pool, "SELECT customer_id, loyalty_points FROM vw_customer_loyalty ORDER BY 1");
    const direct = await q(pool, "SELECT c.customer_id, COALESCE(SUM(a.points_awarded),0) pts FROM customer c LEFT JOIN loyalty_award a ON a.customer_id = c.customer_id GROUP BY c.customer_id ORDER BY 1");
    expect(view.map((r) => Number(r.loyalty_points))).toEqual(direct.map((r) => Number(r.pts)));
    expect(view.slice(0, 2).map((r) => Number(r.loyalty_points))).toEqual([0, 650]); // customers 1 and 2 are untouched by other files
    const [s20] = await q(pool, "SELECT delivered_revenue, certification_count FROM vw_supplier_performance WHERE supplier_id=20");
    const [direct20] = await q(pool, `SELECT COALESCE(ROUND(SUM(l.line_total),2),0) rev FROM order_line l JOIN product p ON p.product_id = l.product_id
      JOIN sales_order o ON o.order_id = l.order_id WHERE p.supplier_id = 20 AND o.order_status = 'delivered'`);
    expect(s20).toMatchObject({ delivered_revenue: String(direct20!.rev), certification_count: 2 });
    expect(Number(s20!.delivered_revenue)).toBeGreaterThanOrEqual(102000); // the original 5002 + 5003
  });
  it("vw_low_stock reproduces sp_queue_reorders' selection and quantity", async () => {
    const wh = ctxWith(["warehouse"]);
    const v = await lowStock(pool, wh);
    const d = await q(pool, "SELECT product_id, GREATEST(reorder_qty, reorder_point-qty_on_hand) requested_qty FROM product_inventory WHERE qty_on_hand<=reorder_point ORDER BY product_id");
    expect(v.map((x) => [x.product_id, x.requested_qty])).toEqual(d.map((x) => [x.product_id, x.requested_qty]));
  });
});

describe("snapshot diff (trace groundwork)", () => {
  it("detects inserted, updated and deleted rows by primary key", async () => {
    const before = await snapshotTable(pool, cfg.APP_DB_NAME, "product_inventory");
    const after = structuredClone(before);
    after.rows[0]!.values.qty_on_hand = 999;
    after.rows.splice(1, 1);
    after.rows.push({ key: "777", values: { product_id: 777, qty_on_hand: 1, reorder_point: 0, reorder_qty: 1 } });
    const kinds = diffSnapshots(before, after).map((c) => [c.kind, c.key]);
    expect(kinds).toEqual([["updated", before.rows[0]!.key], ["inserted", "777"], ["deleted", before.rows[1]!.key]]);
  });
  it.todo("required test 19 (Stage 7): execution traces match observed database state");
});
