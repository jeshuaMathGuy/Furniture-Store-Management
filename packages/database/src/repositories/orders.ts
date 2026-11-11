import type { RowDataPacket } from "mysql2";
import type { Pool } from "../connection.js";
import { mapDbError, DomainError } from "../errors.js";
import { assertCustomerScope, requirePermission, ForbiddenError, type AuthContext } from "../auth/authorize.js";

export interface OrderSummary {
  orderId: number; orderDate: string; status: string; customerId: number; customerName: string;
  lineCount: number; orderTotal: string;
}

const toSummary = (r: RowDataPacket): OrderSummary => ({
  orderId: r.order_id, orderDate: r.order_date, status: r.order_status, customerId: r.customer_id,
  customerName: r.customer_name, lineCount: Number(r.line_count), orderTotal: String(r.order_total),
});

/** A customer sees only their own orders; administrators and warehouse can read any. */
export async function listOrdersForCustomer(pool: Pool, ctx: AuthContext | null, customerId: number): Promise<OrderSummary[]> {
  assertCustomerScope(ctx, customerId, "order:any:read", "order:own:read");
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM vw_order_summary WHERE customer_id = ? ORDER BY order_date DESC", [customerId]);
  return rows.map(toSummary);
}

export async function getOrder(pool: Pool, ctx: AuthContext | null, orderId: number) {
  if (!ctx) throw new ForbiddenError("Authentication required");
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM vw_order_summary WHERE order_id = ?", [orderId]);
  const head = rows[0];
  // Same response for "missing" and "not yours" so order ids cannot be probed.
  if (!head) throw new DomainError("Order not found");
  try { assertCustomerScope(ctx, head.customer_id, "order:any:read", "order:own:read"); }
  catch { throw new DomainError("Order not found"); }
  const [lines] = await pool.query<RowDataPacket[]>(
    `SELECT l.product_id, p.product_name, l.quantity, l.unit_price, l.discount_pct, l.line_total
       FROM order_line l JOIN product p ON p.product_id = l.product_id WHERE l.order_id = ? ORDER BY l.product_id`, [orderId]);
  const [history] = await pool.query<RowDataPacket[]>(
    "SELECT order_status, changed_at, remarks FROM order_status_history WHERE order_id = ? ORDER BY changed_at, history_id", [orderId]);
  return { ...toSummary(head), lines, history };
}

/** Calls the original sp_confirm_order; stock checks, rollback and triggers are all the database's. */
export async function confirmOrder(pool: Pool, ctx: AuthContext | null, orderId: number): Promise<void> {
  requirePermission(ctx, "order:confirm");
  try { await pool.query("CALL sp_confirm_order(?)", [orderId]); } catch (e) { mapDbError(e); }
}

/** Status changes go through the bu_sales_order state machine; invalid ones surface the trigger's error. */
export async function transitionOrder(pool: Pool, ctx: AuthContext | null, orderId: number,
  status: "placed" | "confirmed" | "shipped" | "delivered" | "cancelled"): Promise<void> {
  requirePermission(ctx, "order:any:transition");
  if (status === "confirmed") throw new DomainError("Use confirmOrder: confirmation must deduct inventory via sp_confirm_order");
  try {
    const [res] = await pool.query<import("mysql2").ResultSetHeader>(
      "UPDATE sales_order SET order_status = ? WHERE order_id = ?", [status, orderId]);
    if (res.affectedRows !== 1) throw new DomainError("Order not found");
  } catch (e) { if (e instanceof DomainError) throw e; mapDbError(e); }
}
