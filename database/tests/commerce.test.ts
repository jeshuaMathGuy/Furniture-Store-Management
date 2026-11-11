import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Pool } from "../../packages/database/src/connection.js";
import { login } from "../../packages/database/src/auth/session.js";
import { ForbiddenError, type AuthContext } from "../../packages/database/src/auth/authorize.js";
import { DomainError } from "../../packages/database/src/errors.js";
import * as commerce from "../../packages/database/src/repositories/commerce.js";
import * as ops from "../../packages/database/src/repositories/operations.js";
import { confirmOrder } from "../../packages/database/src/repositories/orders.js";
import { queueReorders, receiveGoods } from "../../packages/database/src/repositories/inventory.js";
import { inTransaction, nextId, observeEffects } from "../../packages/database/src/repositories/support.js";
import { q, testCfg } from "./helpers.js";

/**
 * Commerce and operations against the test application DB, through the
 * least-privilege furni_app user. Only customer 3 (Mira) places orders here,
 * so other test files' expectations about customers 1 and 2 stay valid.
 */
const cfg = testCfg();
const ASOF = "2026-11-10"; // "Living Room Refresh" (8.5% on product 201) is active
let pool: Pool;
let mira: AuthContext, asha: AuthContext, admin: AuthContext, warehouse: AuthContext, student: AuthContext, cedar: AuthContext;

beforeAll(async () => {
  pool = createPool(cfg, "app", cfg.APP_DB_NAME, 10);
  const pw = cfg.DEMO_ACCOUNT_PASSWORD;
  [mira, asha, admin, warehouse, student, cedar] = (await Promise.all(
    ["mira.nair@example.com", "asha.rao@example.com", "admin@furniform.local", "warehouse@furniform.local", "student@furniform.local", "cedarworks@furniform.local"]
      .map(async (e) => (await login(pool, e, pw)).context))) as [AuthContext, AuthContext, AuthContext, AuthContext, AuthContext, AuthContext];
});
afterAll(async () => { await pool?.end(); });

const stock = async (id: number) => Number((await q(pool, "SELECT qty_on_hand FROM product_inventory WHERE product_id = ?", [id]))[0]!.qty_on_hand);
const status = async (id: number) => (await q(pool, "SELECT order_status FROM sales_order WHERE order_id = ?", [id]))[0]!.order_status;
const miraAddress = async () => (await commerce.listAddresses(pool, mira))[0]!.addressId;
async function emptyCart(ctx: AuthContext) { for (const l of (await commerce.getCart(pool, ctx, ASOF)).lines) await commerce.setCartQuantity(pool, ctx, l.productId, 0); }

describe("id allocation (finding F18: original INT keys have no AUTO_INCREMENT)", () => {
  it("issues unique, increasing ids under concurrency, clear of the original sample ids", async () => {
    const ids = await Promise.all(Array.from({ length: 12 }, () => inTransaction(pool, (c) => nextId(c, "goods_receipt"))));
    expect(new Set(ids).size).toBe(12);
    expect(Math.min(...ids)).toBeGreaterThan(7001);
  });
});

describe("cart", () => {
  it("prices lines as checkout will: list price + finish delta, best active offer, generated-column rounding", async () => {
    await emptyCart(mira);
    await commerce.addToCart(pool, mira, { productId: 201, variantId: 2013, quantity: 1 }); // Sage Velvet +6000
    const cart = await commerce.getCart(pool, mira, ASOF);
    expect(cart.lines[0]).toMatchObject({ productId: 201, variantName: "Sage Velvet", unitPrice: "74000.00", discountPct: "8.50", lineTotal: "67710.00", offerName: "Living Room Refresh" });
  });
  it("one finish per product (mirrors order_line's key): another finish replaces it and adds quantity", async () => {
    await commerce.addToCart(pool, mira, { productId: 201, variantId: 2011, quantity: 1 });
    const l = (await commerce.getCart(pool, mira, ASOF)).lines.find((x) => x.productId === 201)!;
    expect(l).toMatchObject({ variantId: 2011, quantity: 2, unitPrice: "68000.00" });
    await commerce.setCartQuantity(pool, mira, 201, 1);
    expect((await commerce.getCart(pool, mira, ASOF)).itemCount).toBe(1);
  });
  it("rejects a finish that belongs to another product, and non-customers", async () => {
    await expect(commerce.addToCart(pool, mira, { productId: 202, variantId: 2011 })).rejects.toThrow("That finish is not available");
    await expect(commerce.addToCart(pool, student, { productId: 202 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(commerce.getCart(pool, admin, ASOF)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("checkout → fulfilment → review → loyalty (happy path)", () => {
  let orderId = 0;
  it("places the order through the original triggers in one transaction", async () => {
    await emptyCart(mira);
    await commerce.addToCart(pool, mira, { productId: 201, variantId: 2011, quantity: 1 });
    await commerce.addToCart(pool, mira, { productId: 302, quantity: 2 });
    const before = { s201: await stock(201), s302: await stock(302) };
    await expect(commerce.placeOrder(pool, mira, { addressId: 999999, asOf: ASOF })).rejects.toThrow("Choose one of your delivery addresses");
    const addressId = await miraAddress();
    const placed = await observeEffects(pool, () => commerce.placeOrder(pool, mira, { addressId, asOf: ASOF }));
    orderId = placed.result.orderId;
    expect(orderId).toBeGreaterThanOrEqual(6001);
    expect(placed.result.total).toBe("81820.00"); // 68000 × 0.915 + 2 × 9800
    expect(await status(orderId)).toBe("placed");
    expect(placed.effects.statusHistory.map((h) => h.order_status)).toEqual(["placed"]);
    expect(placed.effects.auditLog.map((a) => [a.old_value, a.new_value])).toEqual([["draft", "placed"]]);

    const lines = await q(pool, "SELECT product_id, quantity, unit_price, discount_pct, line_total FROM order_line WHERE order_id = ? ORDER BY product_id", [orderId]);
    expect(lines).toEqual([
      { product_id: 201, quantity: 1, unit_price: "68000.00", discount_pct: "8.50", line_total: "62220.00" },
      { product_id: 302, quantity: 2, unit_price: "9800.00", discount_pct: "0.00", line_total: "19600.00" }]);
    expect((await q(pool, "SELECT plan_code FROM order_plan WHERE order_id = ? ORDER BY 1", [orderId])).map((r) => r.plan_code)).toEqual(["LINDEN24", "URBAN24"]);
    expect(await q(pool, "SELECT amount, payment_status, provider FROM payment_record WHERE order_id = ?", [orderId])).toEqual([{ amount: "81820.00", payment_status: "authorized", provider: "simulated" }]);
    expect((await q(pool, "SELECT variant_id FROM order_line_configuration WHERE order_id = ? AND product_id = 201", [orderId]))[0]!.variant_id).toBe(2011);
    expect((await commerce.getCart(pool, mira, ASOF)).itemCount).toBe(0);
    // Stock is not reserved at checkout; sp_confirm_order deducts it (original design).
    expect([await stock(201), await stock(302)]).toEqual([before.s201, before.s302]);
  });

  it("warehouse confirms (sp_confirm_order deducts stock), ships and delivers; payment is captured", async () => {
    const s302 = await stock(302);
    await confirmOrder(pool, warehouse, orderId);
    expect(await stock(302)).toBe(s302 - 2);
    await ops.shipOrder(pool, warehouse, orderId, "BlueDart", "BD123");
    const delivered = await observeEffects(pool, () => ops.deliverOrder(pool, warehouse, orderId));
    expect(delivered.effects.auditLog.map((a) => a.new_value)).toEqual(["delivered"]);
    const d = await commerce.getOrderDetail(pool, mira, orderId);
    expect(d.status).toBe("delivered");
    expect(d.history.map((h) => h.order_status)).toEqual(["placed", "confirmed", "shipped", "delivered"]);
    expect(d.payments[0]).toMatchObject({ payment_status: "captured" });
    expect(d.shipment).toMatchObject({ carrier: "BlueDart", tracking_ref: "BD123" });
    expect(d.plans.map((p) => p.plan_code)).toEqual(["LINDEN24", "URBAN24"]);
    expect(d.plans.every((p) => typeof p.expires_on === "string")).toBe(true); // fn_warranty_expiry
  });

  it("other customers cannot see the order; skipping a state is rejected by the trigger", async () => {
    await expect(commerce.getOrderDetail(pool, asha, orderId)).rejects.toThrow("Order not found");
    await expect(ops.shipOrder(pool, warehouse, orderId, "BlueDart")).rejects.toThrow("Invalid order status transition");
  });

  it("reviews: only delivered purchases, once per piece", async () => {
    expect((await commerce.reviewablePieces(pool, mira)).map((p) => p.productId)).toEqual(expect.arrayContaining([201, 302]));
    await commerce.addReview(pool, mira, { productId: 302, rating: 5, comment: "Lovely weave" });
    await expect(commerce.addReview(pool, mira, { productId: 302, rating: 4 })).rejects.toThrow("already reviewed");
    await expect(commerce.addReview(pool, mira, { productId: 405, rating: 4 })).rejects.toThrow("delivered orders");
    await expect(commerce.addReview(pool, mira, { productId: 201, rating: 9 })).rejects.toThrow();
  });

  it("sp_award_loyalty awards FLOOR(total/100) points for the delivered order", async () => {
    const before = (await commerce.myLoyalty(pool, mira)).points;
    const today = new Date().toISOString().slice(0, 10);
    expect(await ops.awardLoyalty(pool, admin, today)).toBeGreaterThanOrEqual(818);
    expect((await commerce.myLoyalty(pool, mira)).points).toBe(before + 818);
    await expect(ops.awardLoyalty(pool, warehouse, today)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("checkout failures roll back completely", () => {
  it("a declined simulated payment leaves no order and keeps the cart", async () => {
    await emptyCart(mira);
    await commerce.addToCart(pool, mira, { productId: 205, quantity: 1 });
    const before = Number((await q(pool, "SELECT COUNT(*) n FROM sales_order"))[0]!.n);
    await expect(commerce.placeOrder(pool, mira, { addressId: await miraAddress(), asOf: ASOF, paymentOutcome: "decline" }))
      .rejects.toBeInstanceOf(commerce.PaymentDeclinedError);
    const after = Number((await q(pool, "SELECT COUNT(*) n FROM sales_order"))[0]!.n);
    expect(after).toBe(before);
    expect((await commerce.getCart(pool, mira, ASOF)).itemCount).toBe(1);
  });
  it("more than the stock on hand is refused, naming the piece", async () => {
    await emptyCart(mira);
    await commerce.addToCart(pool, mira, { productId: 206, quantity: 3 }); // 2 in stock
    await expect(commerce.placeOrder(pool, mira, { addressId: await miraAddress(), asOf: ASOF })).rejects.toThrow("Only 2 of Marble Dining Table in stock");
    await emptyCart(mira);
  });
  it("two simultaneous checkouts of one cart create exactly one order", async () => {
    await commerce.addToCart(pool, mira, { productId: 205, quantity: 1 });
    const addressId = await miraAddress();
    const results = await Promise.allSettled([1, 2].map(() => commerce.placeOrder(pool, mira, { addressId, asOf: ASOF })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(DomainError);
    expect(failed.reason.message).toBe("Your cart is empty");
  });
});

describe("cancellation", () => {
  it("a customer may cancel their own placed order; the payment is refunded and stock untouched", async () => {
    await commerce.addToCart(pool, mira, { productId: 205, quantity: 1 });
    const { orderId } = await commerce.placeOrder(pool, mira, { addressId: await miraAddress(), asOf: ASOF });
    const s = await stock(205);
    const res = await observeEffects(pool, () => commerce.cancelOrder(pool, mira, orderId, "Changed my mind"));
    expect(res.result).toEqual({ previousStatus: "placed", stockRestored: false });
    expect(res.effects.auditLog.map((a) => [a.old_value, a.new_value])).toEqual([["placed", "cancelled"]]);
    expect(await stock(205)).toBe(s);
    expect((await q(pool, "SELECT payment_status FROM payment_record WHERE order_id = ?", [orderId]))[0]!.payment_status).toBe("refunded");
    await expect(commerce.cancelOrder(pool, mira, orderId, "again")).rejects.toThrow("only while placed");
  });
  it("an administrator cancelling a CONFIRMED order returns the deducted stock (enhancement, recorded)", async () => {
    await commerce.addToCart(pool, mira, { productId: 404, quantity: 1 });
    const { orderId } = await commerce.placeOrder(pool, mira, { addressId: await miraAddress(), asOf: ASOF });
    const s = await stock(404);
    await confirmOrder(pool, warehouse, orderId);
    expect(await stock(404)).toBe(s - 1);
    await expect(commerce.cancelOrder(pool, warehouse, orderId, "warehouse cannot")).rejects.toThrow("Order not found");
    expect(await commerce.cancelOrder(pool, admin, orderId, "Supplier delay")).toEqual({ previousStatus: "confirmed", stockRestored: true });
    expect(await stock(404)).toBe(s);
    expect(await q(pool, "SELECT previous_status, stock_restored FROM order_cancellation WHERE order_id = ?", [orderId])).toEqual([{ previous_status: "confirmed", stock_restored: 1 }]);
  });
});

describe("addresses keep postal_code → city, region consistent (3NF dependency)", () => {
  it("rejects a known PIN with a different city, and registers a new PIN", async () => {
    await expect(commerce.addAddress(pool, mira, { line1: "1 Lake View", postalCode: "560001", city: "Chennai", region: "Tamil Nadu" }))
      .rejects.toThrow("recorded as Bengaluru, Karnataka");
    const id = await commerce.addAddress(pool, mira, { line1: "4 Marina Road", postalCode: "600001", city: "Chennai", region: "Tamil Nadu" });
    expect(id).toBeGreaterThan(0);
    expect(await q(pool, "SELECT city, region FROM postal_area WHERE postal_code = '600001'")).toEqual([{ city: "Chennai", region: "Tamil Nadu" }]);
  });
});

describe("operations", () => {
  it("goods receipts: created pending, posted once through sp_receive_goods", async () => {
    const s = await stock(302);
    const id = await ops.createReceipt(pool, warehouse, { receiptDate: "2026-11-12", lines: [{ productId: 302, quantity: 3 }, { productId: 302, quantity: 2 }] });
    expect((await ops.listReceipts(pool, warehouse)).find((r) => r.receiptId === id)).toMatchObject({ status: "pending", lines: [{ productId: 302, qty: 5 }] });
    expect(await stock(302)).toBe(s);
    await receiveGoods(pool, warehouse, id);
    expect(await stock(302)).toBe(s + 5);
    await expect(receiveGoods(pool, warehouse, id)).rejects.toThrow("already been posted");
    // Through furni_app MySQL reports the generic FK error 1216 (no constraint details); it is still mapped.
    await expect(ops.createReceipt(pool, warehouse, { receiptDate: "2026-11-12", lines: [{ productId: 99999, quantity: 1 }] })).rejects.toThrow("foreign key check failed");
  });
  it("reorders: queued by the procedure, advanced open → ordered → closed", async () => {
    await queueReorders(pool, warehouse, "2026-11-12");
    const open = (await ops.listReorders(pool, warehouse)).find((r) => r.request_status === "open")!;
    expect(await ops.advanceReorder(pool, warehouse, open.request_id)).toBe("ordered");
    expect(await ops.advanceReorder(pool, warehouse, open.request_id)).toBe("closed");
    await expect(ops.advanceReorder(pool, warehouse, open.request_id)).rejects.toThrow("already closed");
  });
  it("price changes are audited by au_product; offers obey the original CHECK constraints", async () => {
    const { effects } = await observeEffects(pool, () => ops.setListPrice(pool, admin, 405, "47000"));
    expect(effects.auditLog.map((a) => [a.entity_name, a.entity_key, a.old_value, a.new_value])).toEqual([["product", "405", "46000.00", "47000.00"]]);
    await expect(ops.createOffer(pool, admin, { productId: 405, offerName: "Backwards", discountPct: 5, startDate: "2026-12-01", endDate: "2026-11-01" }))
      .rejects.toThrow("chk_offer_dates");
    const id = await ops.createOffer(pool, admin, { productId: 405, offerName: "Shelving week", discountPct: 10, startDate: "2026-11-01", endDate: "2026-11-30" });
    expect((await ops.listOffers(pool, admin)).find((o) => o.offer_id === id)).toMatchObject({ offer_price: "42300.00" });
  });
  it("settlements via the original procedure; suppliers see only their own data", async () => {
    expect(Number(await ops.buildSettlements(pool, admin, "2026-11-01", "2026-11-30"))).toBeGreaterThan(0);
    const own = await ops.supplierOverview(pool, cedar, 10);
    expect(own.products.every((p) => [101, 102, 103, 104, 105].includes(p.product_id))).toBe(true);
    await expect(ops.supplierOverview(pool, cedar, 20)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await ops.listSettlements(pool, cedar, 10)).every((s) => s.supplier_id === 10)).toBe(true);
    await expect(ops.listSettlements(pool, cedar)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("role boundaries", async () => {
    await expect(ops.shipOrder(pool, mira, 5004, "x")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ops.createReceipt(pool, mira, { receiptDate: "2026-11-12", lines: [{ productId: 101, quantity: 1 }] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ops.setListPrice(pool, warehouse, 101, 1)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ops.dashboard(pool, cedar)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await ops.dashboard(pool, warehouse)).unitsOnHand).toBeGreaterThan(0);
  });
});

