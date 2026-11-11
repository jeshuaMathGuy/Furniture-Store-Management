import { z } from "zod";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { Pool } from "../connection.js";
import { DomainError, mapDbError } from "../errors.js";
import { assertSupplierScope, requirePermission, type AuthContext } from "../auth/authorize.js";
import { inTransaction, nextId } from "./support.js";

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rethrow = (e: unknown): never => { if (e instanceof DomainError) throw e; return mapDbError(e); };

// ---------------------------------------------------------------- dashboard

export async function dashboard(pool: Pool, ctx: AuthContext | null) {
  requirePermission(ctx, "order:any:read");
  const [[byStatus], [[stock]], [[money]], [[queues]]] = await Promise.all([
    pool.query<RowDataPacket[]>("SELECT order_status, COUNT(*) n FROM sales_order GROUP BY order_status"),
    pool.query<RowDataPacket[]>("SELECT (SELECT COUNT(*) FROM vw_low_stock) low_stock, (SELECT COALESCE(SUM(qty_on_hand),0) FROM product_inventory) units"),
    pool.query<RowDataPacket[]>("SELECT COALESCE(SUM(order_total),0) delivered_revenue FROM vw_order_summary WHERE order_status = 'delivered'"),
    pool.query<RowDataPacket[]>(
      "SELECT (SELECT COUNT(*) FROM goods_receipt WHERE receipt_status = 'pending') pending_receipts, (SELECT COUNT(*) FROM reorder_request WHERE request_status = 'open') open_reorders"),
  ]);
  return {
    ordersByStatus: Object.fromEntries(byStatus.map((r) => [r.order_status as string, Number(r.n)])),
    lowStock: Number(stock!.low_stock), unitsOnHand: Number(stock!.units),
    deliveredRevenue: String(money!.delivered_revenue),
    pendingReceipts: Number(queues!.pending_receipts), openReorders: Number(queues!.open_reorders),
  };
}

// ---------------------------------------------------------------- orders and fulfilment

export async function listOrders(pool: Pool, ctx: AuthContext | null, status?: string) {
  requirePermission(ctx, "order:any:read");
  const s = z.enum(["draft", "placed", "confirmed", "shipped", "delivered", "cancelled"]).optional().parse(status || undefined);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM vw_order_summary ${s ? "WHERE order_status = ?" : ""} ORDER BY order_date DESC, order_id DESC LIMIT 200`, s ? [s] : []);
  return rows;
}

/** confirmed → shipped (trigger-validated), recording carrier and tracking on the shipment. */
export async function shipOrder(pool: Pool, ctx: AuthContext | null, orderId: number, carrier: string, trackingRef?: string) {
  requirePermission(ctx, "order:fulfil");
  const c1 = z.string().trim().min(2).max(60).parse(carrier);
  const t = z.string().trim().max(64).optional().parse(trackingRef || undefined);
  try {
    await inTransaction(pool, async (c) => {
      const [[o]] = await c.query<RowDataPacket[]>("SELECT customer_id FROM sales_order WHERE order_id = ? FOR UPDATE", [orderId]);
      if (!o) throw new DomainError("Order not found");
      await c.query("UPDATE sales_order SET order_status = 'shipped' WHERE order_id = ?", [orderId]);
      const [res] = await c.query<ResultSetHeader>(
        "UPDATE shipment SET carrier = ?, tracking_ref = ?, shipped_at = UTC_TIMESTAMP() WHERE order_id = ? AND shipped_at IS NULL", [c1, t ?? null, orderId]);
      if (res.affectedRows === 0) {
        // Orders that predate the extension tables (original sample data) get a shipment to the default address.
        const [[addr]] = await c.query<RowDataPacket[]>("SELECT address_id FROM shipping_address WHERE customer_id = ? ORDER BY is_default DESC, address_id LIMIT 1", [o.customer_id]);
        if (!addr) throw new DomainError("The customer has no delivery address");
        await c.query("INSERT INTO shipment (order_id, address_id, carrier, tracking_ref, shipped_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())", [orderId, addr.address_id, c1, t ?? null]);
      }
    });
  } catch (e) { rethrow(e); }
}

/** shipped → delivered (trigger-validated); captures the authorised simulated payment. */
export async function deliverOrder(pool: Pool, ctx: AuthContext | null, orderId: number) {
  requirePermission(ctx, "order:fulfil");
  try {
    await inTransaction(pool, async (c) => {
      const [[o]] = await c.query<RowDataPacket[]>("SELECT order_id FROM sales_order WHERE order_id = ? FOR UPDATE", [orderId]);
      if (!o) throw new DomainError("Order not found");
      await c.query("UPDATE sales_order SET order_status = 'delivered' WHERE order_id = ?", [orderId]);
      await c.query("UPDATE shipment SET delivered_at = UTC_TIMESTAMP() WHERE order_id = ? AND delivered_at IS NULL", [orderId]);
      await c.query("UPDATE payment_record SET payment_status = 'captured' WHERE order_id = ? AND payment_status = 'authorized'", [orderId]);
    });
  } catch (e) { rethrow(e); }
}

// ---------------------------------------------------------------- inventory, receipts, reorders

export async function inventoryList(pool: Pool, ctx: AuthContext | null) {
  requirePermission(ctx, "inventory:read");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT i.product_id, p.product_name, s.supplier_name, i.qty_on_hand, i.reorder_point, i.reorder_qty,
            (i.qty_on_hand <= i.reorder_point) AS low,
            (SELECT COALESCE(SUM(l.quantity),0) FROM order_line l JOIN sales_order o ON o.order_id = l.order_id
              WHERE l.product_id = i.product_id AND o.order_status = 'placed') AS awaiting_confirmation
       FROM product_inventory i JOIN product p ON p.product_id = i.product_id JOIN supplier s ON s.supplier_id = p.supplier_id
      ORDER BY low DESC, p.product_name`);
  return rows;
}

export async function listReceipts(pool: Pool, ctx: AuthContext | null) {
  requirePermission(ctx, "inventory:read");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.receipt_id, r.receipt_date, r.receipt_status, l.product_id, p.product_name, l.quantity_received
       FROM goods_receipt r LEFT JOIN goods_receipt_line l ON l.receipt_id = r.receipt_id LEFT JOIN product p ON p.product_id = l.product_id
      ORDER BY r.receipt_id DESC, l.product_id`);
  type Receipt = { receiptId: number; date: string; status: string; lines: { productId: number; name: string; qty: number }[] };
  const map = new Map<number, Receipt>();
  for (const r of rows) {
    const e: Receipt = map.get(r.receipt_id) ?? { receiptId: r.receipt_id, date: r.receipt_date, status: r.receipt_status, lines: [] };
    if (r.product_id) e.lines.push({ productId: r.product_id, name: r.product_name, qty: r.quantity_received });
    map.set(r.receipt_id, e);
  }
  return [...map.values()];
}

const NewReceipt = z.object({
  receiptDate: Day,
  lines: z.array(z.object({ productId: z.coerce.number().int().positive(), quantity: z.coerce.number().int().min(1).max(10000) })).min(1).max(30),
});

/** Create a pending receipt. Stock changes only when it is posted through sp_receive_goods. */
export async function createReceipt(pool: Pool, ctx: AuthContext | null, input: z.input<typeof NewReceipt>): Promise<number> {
  requirePermission(ctx, "inventory:receive");
  const r = NewReceipt.parse(input);
  const merged = new Map<number, number>();
  for (const l of r.lines) merged.set(l.productId, (merged.get(l.productId) ?? 0) + l.quantity);
  try {
    return await inTransaction(pool, async (c) => {
      const id = await nextId(c, "goods_receipt");
      await c.query("INSERT INTO goods_receipt (receipt_id, receipt_date, receipt_status) VALUES (?, ?, 'pending')", [id, r.receiptDate]);
      for (const [productId, qty] of merged) await c.query("INSERT INTO goods_receipt_line (receipt_id, product_id, quantity_received) VALUES (?, ?, ?)", [id, productId, qty]);
      return id;
    });
  } catch (e) { return rethrow(e); }
}

export async function listReorders(pool: Pool, ctx: AuthContext | null) {
  requirePermission(ctx, "inventory:read");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.request_id, r.product_id, p.product_name, r.request_date, r.requested_qty, r.request_status
       FROM reorder_request r JOIN product p ON p.product_id = r.product_id ORDER BY r.request_status = 'closed', r.request_date DESC, r.request_id DESC`);
  return rows;
}

const REORDER_FLOW: Record<string, string> = { open: "ordered", ordered: "closed" };

export async function advanceReorder(pool: Pool, ctx: AuthContext | null, requestId: number) {
  requirePermission(ctx, "reorder:manage");
  return inTransaction(pool, async (c) => {
    const [[r]] = await c.query<RowDataPacket[]>("SELECT request_status FROM reorder_request WHERE request_id = ? FOR UPDATE", [requestId]);
    if (!r) throw new DomainError("Reorder request not found");
    const next = REORDER_FLOW[r.request_status];
    if (!next) throw new DomainError("This request is already closed");
    await c.query("UPDATE reorder_request SET request_status = ? WHERE request_id = ?", [next, requestId]);
    return next;
  });
}

// ---------------------------------------------------------------- catalog administration

/** Price changes go through the original au_product trigger, which audits them. */
export async function setListPrice(pool: Pool, ctx: AuthContext | null, productId: number, price: string | number) {
  requirePermission(ctx, "product:manage");
  const p = z.coerce.number().min(0).max(10_000_000).parse(price);
  try {
    const [res] = await pool.query<ResultSetHeader>("UPDATE product SET list_price = ? WHERE product_id = ?", [p.toFixed(2), productId]);
    if (res.affectedRows === 0) throw new DomainError("Product not found");
  } catch (e) { rethrow(e); }
}

export async function setProductActive(pool: Pool, ctx: AuthContext | null, productId: number, active: boolean) {
  requirePermission(ctx, "product:manage");
  await pool.query("UPDATE product SET is_active = ? WHERE product_id = ?", [active, productId]);
}

export async function productAdminList(pool: Pool, ctx: AuthContext | null) {
  requirePermission(ctx, "product:manage");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.product_id, p.product_name, p.list_price, p.is_active, s.supplier_name, COALESCE(i.qty_on_hand,0) qty_on_hand
       FROM product p JOIN supplier s ON s.supplier_id = p.supplier_id LEFT JOIN product_inventory i ON i.product_id = p.product_id
      ORDER BY p.product_id`);
  return rows;
}

const NewOffer = z.object({
  productId: z.coerce.number().int().positive(), offerName: z.string().trim().min(3).max(120),
  discountPct: z.coerce.number().min(0.01).max(100), startDate: Day, endDate: Day,
});

/** Offer validity (CHECK end_date >= start_date, 0–100 %) is enforced by the original constraints. */
export async function createOffer(pool: Pool, ctx: AuthContext | null, input: z.input<typeof NewOffer>): Promise<number> {
  requirePermission(ctx, "offer:manage");
  const o = NewOffer.parse(input);
  try {
    return await inTransaction(pool, async (c) => {
      const id = await nextId(c, "offer");
      await c.query("INSERT INTO offer (offer_id, product_id, offer_name, discount_pct, start_date, end_date, is_active) VALUES (?, ?, ?, ?, ?, ?, TRUE)",
        [id, o.productId, o.offerName, o.discountPct.toFixed(2), o.startDate, o.endDate]);
      return id;
    });
  } catch (e) { return rethrow(e); }
}

export async function listOffers(pool: Pool, ctx: AuthContext | null) {
  requirePermission(ctx, "offer:manage");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT o.*, p.product_name, fn_discounted_price(p.list_price, o.discount_pct) offer_price
       FROM offer o JOIN product p ON p.product_id = o.product_id ORDER BY o.end_date DESC, o.offer_id DESC`);
  return rows;
}

export async function setOfferActive(pool: Pool, ctx: AuthContext | null, offerId: number, active: boolean) {
  requirePermission(ctx, "offer:manage");
  await pool.query("UPDATE offer SET is_active = ? WHERE offer_id = ?", [active, offerId]);
}

// ---------------------------------------------------------------- settlements and loyalty (original procedures)

export async function buildSettlements(pool: Pool, ctx: AuthContext | null, periodStart: string, periodEnd: string) {
  requirePermission(ctx, "settlement:manage");
  const [a, b] = [Day.parse(periodStart), Day.parse(periodEnd)];
  const conn = await pool.getConnection();
  try {
    await conn.query("CALL sp_build_supplier_settlements(?, ?, @furni_total)", [a, b]);
    const [[r]] = await conn.query<RowDataPacket[]>("SELECT @furni_total AS total");
    return String(r!.total ?? "0.00");
  } catch (e) { return rethrow(e); } finally { conn.release(); }
}

export async function listSettlements(pool: Pool, ctx: AuthContext | null, supplierId?: number) {
  if (supplierId !== undefined) assertSupplierScope(ctx, supplierId);
  else requirePermission(ctx, "settlement:manage");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT st.*, s.supplier_name FROM supplier_settlement st JOIN supplier s ON s.supplier_id = st.supplier_id
      ${supplierId !== undefined ? "WHERE st.supplier_id = ?" : ""} ORDER BY st.period_start DESC, st.supplier_id`, supplierId !== undefined ? [supplierId] : []);
  return rows;
}

export async function awardLoyalty(pool: Pool, ctx: AuthContext | null, cutoff: string) {
  requirePermission(ctx, "loyalty:manage");
  const day = Day.parse(cutoff);
  const conn = await pool.getConnection();
  try {
    await conn.query("CALL sp_award_loyalty(?, @furni_points)", [day]);
    const [[r]] = await conn.query<RowDataPacket[]>("SELECT @furni_points AS points");
    return Number(r!.points ?? 0);
  } catch (e) { return rethrow(e); } finally { conn.release(); }
}

export async function loyaltyOverview(pool: Pool, ctx: AuthContext | null) {
  requirePermission(ctx, "loyalty:manage");
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM vw_customer_loyalty ORDER BY loyalty_points DESC, customer_id");
  return rows;
}

// ---------------------------------------------------------------- audit and supplier portal

export async function recentAudit(pool: Pool, ctx: AuthContext | null, limit = 50) {
  requirePermission(ctx, "report:read");
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM audit_log ORDER BY audit_id DESC LIMIT ?", [Math.min(200, Math.max(1, limit))]);
  return rows;
}

/** Everything a supplier may see about itself, and nothing about other suppliers or customers. */
export async function supplierOverview(pool: Pool, ctx: AuthContext | null, supplierId: number) {
  assertSupplierScope(ctx, supplierId);
  const [[[supplier]], [products], [certs], [regions], [receipts], [settlements], [plans]] = await Promise.all([
    pool.query<RowDataPacket[]>("SELECT supplier_id, supplier_name, is_active FROM supplier WHERE supplier_id = ?", [supplierId]),
    pool.query<RowDataPacket[]>(
      `SELECT p.product_id, p.product_name, p.list_price, p.is_active, COALESCE(i.qty_on_hand,0) qty_on_hand, i.reorder_point,
              (SELECT COALESCE(SUM(l.quantity),0) FROM order_line l JOIN sales_order o ON o.order_id = l.order_id
                WHERE l.product_id = p.product_id AND o.order_status = 'delivered') AS units_delivered
         FROM product p LEFT JOIN product_inventory i ON i.product_id = p.product_id WHERE p.supplier_id = ? ORDER BY p.product_id`, [supplierId]),
    pool.query<RowDataPacket[]>("SELECT certification FROM supplier_certification WHERE supplier_id = ? ORDER BY 1", [supplierId]),
    pool.query<RowDataPacket[]>("SELECT service_region FROM supplier_service_region WHERE supplier_id = ? ORDER BY 1", [supplierId]),
    pool.query<RowDataPacket[]>(
      `SELECT r.receipt_id, r.receipt_date, r.receipt_status, l.product_id, p.product_name, l.quantity_received
         FROM goods_receipt r JOIN goods_receipt_line l ON l.receipt_id = r.receipt_id JOIN product p ON p.product_id = l.product_id
        WHERE p.supplier_id = ? ORDER BY r.receipt_id DESC`, [supplierId]),
    pool.query<RowDataPacket[]>("SELECT period_start, period_end, settlement_amount, generated_at FROM supplier_settlement WHERE supplier_id = ? ORDER BY period_start DESC", [supplierId]),
    pool.query<RowDataPacket[]>("SELECT plan_code, warranty_months FROM warranty_plan WHERE supplier_id = ? ORDER BY plan_code", [supplierId]),
  ]);
  if (!supplier) throw new DomainError("Supplier not found");
  return { supplier, products, certifications: certs.map((c) => c.certification as string), regions: regions.map((r) => r.service_region as string), receipts, settlements, plans };
}
