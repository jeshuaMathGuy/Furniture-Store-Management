import type { RowDataPacket } from "mysql2";
import type { Pool } from "../connection.js";
import { DomainError, mapDbError } from "../errors.js";
import { requirePermission, type AuthContext } from "../auth/authorize.js";

/**
 * Posts a goods receipt via the original sp_receive_goods.
 *
 * Mitigation for source finding F1: the procedure's pending-status check is a
 * non-locking read and its final UPDATE is not row-count checked, so two
 * concurrent calls can double-post stock. The procedure is preserved unchanged.
 * The service serialises calls per receipt with a named lock instead.
 */
export async function receiveGoods(pool: Pool, ctx: AuthContext | null, receiptId: number, lockTimeoutSec = 5): Promise<void> {
  requirePermission(ctx, "inventory:receive");
  const conn = await pool.getConnection();
  const lockName = `furni:receipt:${receiptId}`;
  try {
    const [[got]] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK(?, ?) AS ok", [lockName, lockTimeoutSec]);
    if (Number(got?.ok) !== 1) throw new DomainError("Receipt is being posted by another session; try again");
    try {
      await conn.query("CALL sp_receive_goods(?)", [receiptId]);
    } catch (e) { mapDbError(e); }
    finally { await conn.query("SELECT RELEASE_LOCK(?)", [lockName]); }
  } finally {
    conn.release();
  }
}

export async function queueReorders(pool: Pool, ctx: AuthContext | null, requestDate: string): Promise<number> {
  requirePermission(ctx, "reorder:manage");
  const conn = await pool.getConnection();
  try {
    // OUT parameters are read back through a session variable on the SAME connection.
    await conn.query("CALL sp_queue_reorders(?, @furni_queued)", [requestDate]).catch(mapDbError);
    const [[row]] = await conn.query<RowDataPacket[]>("SELECT @furni_queued AS queued");
    return Number(row?.queued);
  } finally {
    conn.release();
  }
}

export async function lowStock(pool: Pool, ctx: AuthContext | null) {
  requirePermission(ctx, "inventory:read");
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM vw_low_stock ORDER BY product_id");
  return rows;
}
