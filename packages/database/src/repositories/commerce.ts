import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { Pool } from "../connection.js";
import { DomainError, mapDbError } from "../errors.js";
import { ForbiddenError, assertCustomerScope, requirePermission, type AuthContext } from "../auth/authorize.js";
import { inTransaction, nextId } from "./support.js";
import { roleHas } from "@furni/shared";

const AsOf = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A signed-in customer acting on their own cart, orders, reviews and addresses. */
function customerOf(ctx: AuthContext | null): number {
  requirePermission(ctx, "cart:own");
  if (!ctx.customerId) throw new ForbiddenError("This account is not linked to a customer");
  return ctx.customerId;
}

type Q = Pick<PoolConnection, "query">;

// ---------------------------------------------------------------- pricing

export interface QuotedLine {
  productId: number; name: string; modelKey: string | null; material: string | null; supplierId: number;
  variantId: number | null; variantName: string | null; colorHex: string | null; priceDelta: string;
  quantity: number; listPrice: string; unitPrice: string; discountPct: string; offerId: number | null; offerName: string | null;
  lineTotal: string; qtyOnHand: number; variantQtyOnHand: number | null; available: boolean; active: boolean;
}

/**
 * Price cart items exactly as checkout will: unit = list price + variant delta,
 * discount = best active offer on the as-of date, and line total computed with
 * the same expression as order_line's generated column.
 */
async function quote(q: Q, items: { productId: number; variantId: number | null; quantity: number }[], asOf: string, lock = false): Promise<QuotedLine[]> {
  if (items.length === 0) return [];
  const ids = items.map((i) => i.productId);
  const lockSql = lock ? " FOR SHARE" : "";
  const [products] = await q.query<RowDataPacket[]>(
    `SELECT p.product_id, p.product_name, p.list_price, p.supplier_id, p.is_active, d.model_key, d.primary_material,
            COALESCE(i.qty_on_hand, 0) qty
       FROM product p LEFT JOIN product_detail d ON d.product_id = p.product_id
       LEFT JOIN product_inventory i ON i.product_id = p.product_id
      WHERE p.product_id IN (?)${lockSql}`, [ids]);
  const [offers] = await q.query<RowDataPacket[]>(
    `SELECT o.product_id, o.offer_id, o.offer_name, o.discount_pct FROM offer o
      WHERE o.product_id IN (?) AND o.is_active = TRUE AND ? BETWEEN o.start_date AND o.end_date
      ORDER BY o.discount_pct DESC, o.offer_id`, [ids, asOf]);
  const variantIds = items.map((i) => i.variantId).filter((v): v is number => v !== null);
  const [variants] = variantIds.length
    ? await q.query<RowDataPacket[]>(
      `SELECT v.variant_id, v.product_id, v.variant_name, v.color_hex, v.price_delta, v.is_active, vi.qty_on_hand
         FROM product_variant v LEFT JOIN product_variant_inventory vi ON vi.variant_id = v.variant_id
        WHERE v.variant_id IN (?)${lockSql}`, [variantIds])
    : [[] as RowDataPacket[]];

  return items.map((it) => {
    const p = products.find((x) => x.product_id === it.productId);
    if (!p) throw new DomainError(`Product ${it.productId} no longer exists`);
    const v = it.variantId ? variants.find((x) => x.variant_id === it.variantId && x.product_id === it.productId) : undefined;
    const best = offers.find((o) => o.product_id === it.productId);
    const unit = Number(p.list_price) + Number(v?.price_delta ?? 0);
    const disc = Number(best?.discount_pct ?? 0);
    // Mirrors: line_total = ROUND(quantity*unit_price*(1-discount_pct/100), 2)
    const lineTotal = Math.round(it.quantity * unit * (1 - disc / 100) * 100) / 100;
    const variantStock = v ? (v.qty_on_hand === null ? null : Number(v.qty_on_hand)) : null;
    return {
      productId: p.product_id, name: p.product_name, modelKey: p.model_key, material: p.primary_material, supplierId: p.supplier_id,
      variantId: v?.variant_id ?? null, variantName: v?.variant_name ?? null, colorHex: v?.color_hex ?? null, priceDelta: String(v?.price_delta ?? "0.00"),
      quantity: it.quantity, listPrice: String(p.list_price), unitPrice: unit.toFixed(2), discountPct: disc.toFixed(2),
      offerId: best?.offer_id ?? null, offerName: best?.offer_name ?? null, lineTotal: lineTotal.toFixed(2),
      qtyOnHand: Number(p.qty), variantQtyOnHand: variantStock,
      available: Number(p.qty) >= it.quantity && (variantStock === null || variantStock >= it.quantity),
      active: !!p.is_active && (!it.variantId || (!!v && !!v.is_active)),
    };
  });
}

// ---------------------------------------------------------------- cart

const AddItem = z.object({
  productId: z.coerce.number().int().positive(),
  variantId: z.coerce.number().int().positive().nullable().optional(),
  quantity: z.coerce.number().int().min(1).max(20).default(1),
});

async function cartId(q: Q, userId: number, create: boolean, lock = false): Promise<number | null> {
  if (create) await q.query("INSERT IGNORE INTO cart (user_id) VALUES (?)", [userId]);
  const [[row]] = await q.query<RowDataPacket[]>(`SELECT cart_id FROM cart WHERE user_id = ?${lock ? " FOR UPDATE" : ""}`, [userId]);
  return (row?.cart_id as number | undefined) ?? null;
}

export interface Cart { lines: QuotedLine[]; itemCount: number; subtotal: string; allAvailable: boolean }

export async function getCart(pool: Pool, ctx: AuthContext | null, asOf: string): Promise<Cart> {
  customerOf(ctx);
  const day = AsOf.parse(asOf);
  const id = await cartId(pool, ctx!.userId, false);
  if (!id) return { lines: [], itemCount: 0, subtotal: "0.00", allAvailable: true };
  const [items] = await pool.query<RowDataPacket[]>("SELECT product_id, variant_id, quantity FROM cart_item WHERE cart_id = ? ORDER BY product_id", [id]);
  const lines = await quote(pool, items.map((i) => ({ productId: i.product_id, variantId: i.variant_id, quantity: i.quantity })), day);
  return {
    lines, itemCount: lines.reduce((s, l) => s + l.quantity, 0),
    subtotal: lines.reduce((s, l) => s + Number(l.lineTotal), 0).toFixed(2),
    allAvailable: lines.every((l) => l.available && l.active),
  };
}

export async function cartCount(pool: Pool, ctx: AuthContext | null): Promise<number> {
  if (!ctx?.customerId) return 0;
  const [[r]] = await pool.query<RowDataPacket[]>(
    "SELECT COALESCE(SUM(ci.quantity), 0) n FROM cart c JOIN cart_item ci ON ci.cart_id = c.cart_id WHERE c.user_id = ?", [ctx.userId]);
  return Number(r?.n ?? 0);
}

/**
 * Add a product (optionally a variant). The cart mirrors order_line's key
 * (one row per product), so choosing another finish of the same product
 * replaces the finish and adds to the quantity (max 20).
 */
export async function addToCart(pool: Pool, ctx: AuthContext | null, input: z.input<typeof AddItem>): Promise<void> {
  customerOf(ctx);
  const it = AddItem.parse(input);
  await inTransaction(pool, async (c) => {
    const [[p]] = await c.query<RowDataPacket[]>("SELECT is_active FROM product WHERE product_id = ?", [it.productId]);
    if (!p || !p.is_active) throw new DomainError("This piece is not available");
    if (it.variantId) {
      const [[v]] = await c.query<RowDataPacket[]>("SELECT is_active FROM product_variant WHERE variant_id = ? AND product_id = ?", [it.variantId, it.productId]);
      if (!v || !v.is_active) throw new DomainError("That finish is not available for this piece");
    }
    const id = await cartId(c, ctx!.userId, true, true);
    await c.query(
      `INSERT INTO cart_item (cart_id, product_id, variant_id, quantity) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE variant_id = VALUES(variant_id), quantity = LEAST(20, quantity + VALUES(quantity))`,
      [id, it.productId, it.variantId ?? null, it.quantity]);
  });
}

export async function setCartQuantity(pool: Pool, ctx: AuthContext | null, productId: number, quantity: number): Promise<void> {
  customerOf(ctx);
  const q = z.coerce.number().int().min(0).max(20).parse(quantity);
  const id = await cartId(pool, ctx!.userId, false);
  if (!id) return;
  if (q === 0) await pool.query("DELETE FROM cart_item WHERE cart_id = ? AND product_id = ?", [id, productId]);
  else await pool.query("UPDATE cart_item SET quantity = ? WHERE cart_id = ? AND product_id = ?", [q, id, productId]);
}

// ---------------------------------------------------------------- addresses

export async function listAddresses(pool: Pool, ctx: AuthContext | null) {
  const customerId = customerOf(ctx);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT a.address_id, a.line1, a.line2, a.postal_code, p.city, p.region, a.is_default
       FROM shipping_address a JOIN postal_area p ON p.postal_code = a.postal_code
      WHERE a.customer_id = ? ORDER BY a.is_default DESC, a.address_id`, [customerId]);
  return rows.map((r) => ({ addressId: r.address_id as number, line1: r.line1 as string, line2: r.line2 as string | null,
    postalCode: r.postal_code as string, city: r.city as string, region: r.region as string, isDefault: !!r.is_default }));
}

const NewAddress = z.object({
  line1: z.string().trim().min(3).max(160), line2: z.string().trim().max(160).optional(),
  postalCode: z.string().trim().regex(/^\d{6}$/, "Enter a 6-digit PIN code"),
  city: z.string().trim().min(2).max(80), region: z.string().trim().min(2).max(80),
});

/**
 * postal_code → city, region is a 3NF dependency in the original schema, so a
 * known PIN code must keep its recorded city. A new one is added to postal_area.
 */
export async function addAddress(pool: Pool, ctx: AuthContext | null, input: z.input<typeof NewAddress>): Promise<number> {
  const customerId = customerOf(ctx);
  const a = NewAddress.parse(input);
  return inTransaction(pool, async (c) => {
    const [[known]] = await c.query<RowDataPacket[]>("SELECT city, region FROM postal_area WHERE postal_code = ? FOR UPDATE", [a.postalCode]);
    if (known && (known.city.toLowerCase() !== a.city.toLowerCase() || known.region.toLowerCase() !== a.region.toLowerCase()))
      throw new DomainError(`PIN code ${a.postalCode} is recorded as ${known.city}, ${known.region}`);
    if (!known) await c.query("INSERT INTO postal_area (postal_code, city, region) VALUES (?, ?, ?)", [a.postalCode, a.city, a.region]);
    const [res] = await c.query<ResultSetHeader>(
      "INSERT INTO shipping_address (customer_id, line1, line2, postal_code, is_default) VALUES (?, ?, ?, ?, FALSE)",
      [customerId, a.line1, a.line2 || null, a.postalCode]);
    return res.insertId;
  });
}

// ---------------------------------------------------------------- checkout

const Checkout = z.object({
  addressId: z.coerce.number().int().positive(),
  /** Local simulated payment. "decline" lets the demo show a rolled-back checkout. No card data is ever accepted. */
  paymentOutcome: z.enum(["approve", "decline"]).default("approve"),
  asOf: AsOf,
});

export class PaymentDeclinedError extends DomainError {
  constructor() { super("The simulated payment was declined. Nothing was charged and no order was created."); this.name = "PaymentDeclinedError"; }
}

export interface PlacedOrder { orderId: number; total: string; paymentRef: string; lines: number }

/**
 * Cart to placed order in ONE transaction, following the path the original
 * triggers require (audit finding F4):
 *   sales_order(draft) [bi_sales_order: active customer]
 *   → order_line rows   [bi_order_line: draft order + active product]
 *   → order_line_configuration, order_plan, shipment, payment_record (extensions)
 *   → status 'placed'   [bu_sales_order state machine; au_sales_order writes history + audit]
 * Any failure, including a declined simulated payment, rolls back everything
 * and leaves the cart unchanged. Stock is checked here with locking reads, but
 * it is deducted only when sp_confirm_order confirms the order (original design).
 */
export async function placeOrder(pool: Pool, ctx: AuthContext | null, input: z.input<typeof Checkout>): Promise<PlacedOrder> {
  const customerId = customerOf(ctx);
  requirePermission(ctx, "order:own:create");
  const req = Checkout.parse(input);
  try {
    return await inTransaction(pool, async (c) => {
      const id = await cartId(c, ctx!.userId, false, true); // locks the cart: concurrent checkouts serialise
      const [items] = id
        ? await c.query<RowDataPacket[]>("SELECT product_id, variant_id, quantity FROM cart_item WHERE cart_id = ? ORDER BY product_id FOR UPDATE", [id])
        : [[] as RowDataPacket[]];
      if (!id || items.length === 0) throw new DomainError("Your cart is empty");

      const [[addr]] = await c.query<RowDataPacket[]>("SELECT address_id FROM shipping_address WHERE address_id = ? AND customer_id = ?", [req.addressId, customerId]);
      if (!addr) throw new DomainError("Choose one of your delivery addresses");

      const lines = await quote(c, items.map((i) => ({ productId: i.product_id, variantId: i.variant_id, quantity: i.quantity })), req.asOf, true);
      const inactive = lines.find((l) => !l.active);
      if (inactive) throw new DomainError(`${inactive.name} is no longer available`);
      const short = lines.find((l) => !l.available);
      if (short) throw new DomainError(`Only ${Math.min(short.qtyOnHand, short.variantQtyOnHand ?? Infinity)} of ${short.name}${short.variantName ? ` (${short.variantName})` : ""} in stock`);

      const orderId = await nextId(c, "sales_order");
      await c.query("INSERT INTO sales_order (order_id, customer_id, order_date, order_status) VALUES (?, ?, UTC_TIMESTAMP(), 'draft')", [orderId, customerId]);
      for (const l of lines) {
        await c.query("INSERT INTO order_line (order_id, product_id, quantity, unit_price, discount_pct) VALUES (?, ?, ?, ?, ?)",
          [orderId, l.productId, l.quantity, l.unitPrice, l.discountPct]);
        await c.query("INSERT INTO order_line_configuration (order_id, product_id, variant_id, configuration, offer_id) VALUES (?, ?, ?, ?, ?)",
          [orderId, l.productId, l.variantId, JSON.stringify({ variant: l.variantName, colorHex: l.colorHex, priceDelta: l.priceDelta, listPrice: l.listPrice, offer: l.offerName, asOf: req.asOf }), l.offerId]);
      }
      // One warranty plan per supplier on the order (the BCNF order_plan relation): the longest plan offered.
      for (const supplierId of new Set(lines.map((l) => l.supplierId))) {
        const [[plan]] = await c.query<RowDataPacket[]>("SELECT plan_code FROM warranty_plan WHERE supplier_id = ? ORDER BY warranty_months DESC, plan_code LIMIT 1", [supplierId]);
        if (plan) await c.query("INSERT INTO order_plan (order_id, plan_code) VALUES (?, ?)", [orderId, plan.plan_code]);
      }
      await c.query("INSERT INTO shipment (order_id, address_id, carrier) VALUES (?, ?, 'Pending allocation')", [orderId, req.addressId]);

      // The authoritative total comes from the generated column, not from application arithmetic.
      const [[sum]] = await c.query<RowDataPacket[]>("SELECT ROUND(SUM(line_total), 2) t FROM order_line WHERE order_id = ?", [orderId]);
      const total = String(sum!.t);
      if (req.paymentOutcome === "decline") throw new PaymentDeclinedError();
      const paymentRef = "SIM-" + randomBytes(6).toString("hex").toUpperCase();
      await c.query("INSERT INTO payment_record (order_id, provider, provider_ref, amount, payment_status) VALUES (?, 'simulated', ?, ?, 'authorized')", [orderId, paymentRef, total]);

      await c.query("UPDATE sales_order SET order_status = 'placed' WHERE order_id = ?", [orderId]);
      await c.query("DELETE FROM cart_item WHERE cart_id = ?", [id]);
      return { orderId, total, paymentRef, lines: lines.length };
    });
  } catch (e) {
    if (e instanceof DomainError) throw e;
    mapDbError(e);
  }
}

// ---------------------------------------------------------------- order detail, cancellation

export async function getOrderDetail(pool: Pool, ctx: AuthContext | null, orderId: number) {
  if (!ctx) throw new ForbiddenError("Authentication required");
  const [[head]] = await pool.query<RowDataPacket[]>("SELECT * FROM vw_order_summary WHERE order_id = ?", [orderId]);
  if (!head) throw new DomainError("Order not found");
  try { assertCustomerScope(ctx, head.customer_id, "order:any:read", "order:own:read"); } catch { throw new DomainError("Order not found"); }
  const [[lines], [history], [payments], [shipment], [plans], [cancel], [audit]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT l.product_id, p.product_name, d.model_key, d.primary_material, l.quantity, l.unit_price, l.discount_pct, l.line_total,
              c.configuration, c.variant_id, s.supplier_name
         FROM order_line l JOIN product p ON p.product_id = l.product_id JOIN supplier s ON s.supplier_id = p.supplier_id
         LEFT JOIN product_detail d ON d.product_id = l.product_id
         LEFT JOIN order_line_configuration c ON c.order_id = l.order_id AND c.product_id = l.product_id
        WHERE l.order_id = ? ORDER BY l.product_id`, [orderId]),
    pool.query<RowDataPacket[]>("SELECT history_id, order_status, changed_at, remarks FROM order_status_history WHERE order_id = ? ORDER BY changed_at, history_id", [orderId]),
    pool.query<RowDataPacket[]>("SELECT provider, provider_ref, amount, payment_status, created_at FROM payment_record WHERE order_id = ? ORDER BY payment_id", [orderId]),
    pool.query<RowDataPacket[]>(
      `SELECT sh.carrier, sh.tracking_ref, sh.shipped_at, sh.delivered_at, a.line1, a.line2, a.postal_code, pa.city, pa.region
         FROM shipment sh JOIN shipping_address a ON a.address_id = sh.address_id JOIN postal_area pa ON pa.postal_code = a.postal_code
        WHERE sh.order_id = ? ORDER BY sh.shipment_id LIMIT 1`, [orderId]),
    // Warranty expiry uses the original fn_warranty_expiry.
    pool.query<RowDataPacket[]>(
      `SELECT w.plan_code, w.warranty_months, s.supplier_name, fn_warranty_expiry(DATE(o.order_date), w.warranty_months) AS expires_on
         FROM order_plan op JOIN warranty_plan w ON w.plan_code = op.plan_code JOIN supplier s ON s.supplier_id = w.supplier_id
         JOIN sales_order o ON o.order_id = op.order_id WHERE op.order_id = ? ORDER BY w.plan_code`, [orderId]),
    pool.query<RowDataPacket[]>("SELECT previous_status, reason, stock_restored, cancelled_at FROM order_cancellation WHERE order_id = ?", [orderId]),
    pool.query<RowDataPacket[]>("SELECT audit_id, event_type, old_value, new_value, event_time FROM audit_log WHERE entity_name = 'sales_order' AND entity_key = ? ORDER BY audit_id", [String(orderId)]),
  ]);
  return {
    orderId: head.order_id as number, orderDate: head.order_date as string, status: head.order_status as string,
    customerId: head.customer_id as number, customerName: head.customer_name as string, orderTotal: String(head.order_total),
    lines, history, payments, shipment: shipment[0] ?? null, plans, cancellation: cancel[0] ?? null, audit,
    canCustomerCancel: head.order_status === "placed" && ctx.customerId === head.customer_id,
  };
}

const CANCELLABLE = ["draft", "placed", "confirmed"] as const;

/**
 * Cancel an order. Customers may cancel their own *placed* orders; staff may
 * cancel draft, placed or confirmed ones (the transitions bu_sales_order allows).
 * Enhancement beyond the source: cancelling a CONFIRMED order returns the stock
 * that sp_confirm_order deducted, in the same transaction, and records that.
 */
export async function cancelOrder(pool: Pool, ctx: AuthContext | null, orderId: number, reason: string) {
  if (!ctx) throw new ForbiddenError("Authentication required");
  const why = z.string().trim().min(3).max(255).parse(reason);
  try {
    return await inTransaction(pool, async (c) => {
      const [[o]] = await c.query<RowDataPacket[]>("SELECT customer_id, order_status FROM sales_order WHERE order_id = ? FOR UPDATE", [orderId]);
      if (!o) throw new DomainError("Order not found");
      const staff = roleHas(ctx.roles, "order:any:transition");
      if (!staff) {
        if (ctx.customerId !== o.customer_id) throw new DomainError("Order not found");
        if (o.order_status !== "placed") throw new DomainError(`Orders can be cancelled online only while placed (this one is ${o.order_status})`);
      }
      if (!(CANCELLABLE as readonly string[]).includes(o.order_status)) throw new DomainError(`A ${o.order_status} order cannot be cancelled`);

      const restore = o.order_status === "confirmed";
      if (restore) {
        const [lines] = await c.query<RowDataPacket[]>("SELECT product_id, quantity FROM order_line WHERE order_id = ? ORDER BY product_id", [orderId]);
        for (const l of lines) await c.query("UPDATE product_inventory SET qty_on_hand = qty_on_hand + ? WHERE product_id = ?", [l.quantity, l.product_id]);
      }
      await c.query("UPDATE sales_order SET order_status = 'cancelled' WHERE order_id = ?", [orderId]); // trigger-validated
      await c.query("INSERT INTO order_cancellation (order_id, cancelled_by, previous_status, reason, stock_restored) VALUES (?, ?, ?, ?, ?)",
        [orderId, ctx.userId || null, o.order_status, why, restore]);
      await c.query("UPDATE payment_record SET payment_status = 'refunded' WHERE order_id = ? AND payment_status IN ('authorized','captured')", [orderId]);
      return { previousStatus: o.order_status as string, stockRestored: restore };
    });
  } catch (e) {
    if (e instanceof DomainError) throw e;
    mapDbError(e);
  }
}

// ---------------------------------------------------------------- reviews and loyalty

const Review = z.object({
  productId: z.coerce.number().int().positive(),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

/** Reviews are limited to pieces from the customer's own delivered orders; feedback is unique per customer and product. */
export async function addReview(pool: Pool, ctx: AuthContext | null, input: z.input<typeof Review>): Promise<number> {
  const customerId = customerOf(ctx);
  requirePermission(ctx, "feedback:own:write");
  const r = Review.parse(input);
  try {
    return await inTransaction(pool, async (c) => {
      const [[bought]] = await c.query<RowDataPacket[]>(
        `SELECT 1 ok FROM sales_order o JOIN order_line l ON l.order_id = o.order_id
          WHERE o.customer_id = ? AND l.product_id = ? AND o.order_status = 'delivered' LIMIT 1`, [customerId, r.productId]);
      if (!bought) throw new DomainError("You can review pieces from your delivered orders");
      const [[dupe]] = await c.query<RowDataPacket[]>("SELECT feedback_id FROM feedback WHERE customer_id = ? AND product_id = ?", [customerId, r.productId]);
      if (dupe) throw new DomainError("You have already reviewed this piece");
      const id = await nextId(c, "feedback");
      await c.query("INSERT INTO feedback (feedback_id, customer_id, product_id, rating, comment) VALUES (?, ?, ?, ?, ?)",
        [id, customerId, r.productId, r.rating, r.comment || null]);
      return id;
    });
  } catch (e) {
    if (e instanceof DomainError) throw e;
    mapDbError(e);
  }
}

export async function reviewablePieces(pool: Pool, ctx: AuthContext | null) {
  const customerId = customerOf(ctx);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT p.product_id, p.product_name, f.rating, f.comment
       FROM sales_order o JOIN order_line l ON l.order_id = o.order_id JOIN product p ON p.product_id = l.product_id
       LEFT JOIN feedback f ON f.customer_id = o.customer_id AND f.product_id = l.product_id
      WHERE o.customer_id = ? AND o.order_status = 'delivered' ORDER BY p.product_name`, [customerId]);
  return rows.map((r) => ({ productId: r.product_id as number, name: r.product_name as string, rating: r.rating as number | null, comment: r.comment as string | null }));
}

export async function myLoyalty(pool: Pool, ctx: AuthContext | null) {
  const customerId = customerOf(ctx);
  requirePermission(ctx, "loyalty:own:read");
  const [[summary]] = await pool.query<RowDataPacket[]>("SELECT loyalty_points, delivered_orders FROM vw_customer_loyalty WHERE customer_id = ?", [customerId]);
  const [awards] = await pool.query<RowDataPacket[]>("SELECT order_id, points_awarded, awarded_at FROM loyalty_award WHERE customer_id = ? ORDER BY awarded_at DESC, order_id DESC", [customerId]);
  return { points: Number(summary?.loyalty_points ?? 0), deliveredOrders: Number(summary?.delivered_orders ?? 0), awards };
}
