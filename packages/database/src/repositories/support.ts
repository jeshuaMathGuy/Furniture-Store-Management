import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { Pool } from "../connection.js";

/** Tables whose original INT keys have no AUTO_INCREMENT (source finding F18). */
const KEYED = {
  sales_order: ["sales_order", "order_id"],
  offer: ["offer", "offer_id"],
  feedback: ["feedback", "feedback_id"],
  goods_receipt: ["goods_receipt", "receipt_id"],
} as const;
export type SequenceName = keyof typeof KEYED;

/**
 * Allocate the next id inside the caller's transaction. The sequence row is
 * locked FOR UPDATE, so concurrent callers serialise. The value never falls
 * below MAX(id)+1, so rows inserted by other means cannot collide.
 */
export async function nextId(conn: PoolConnection, seq: SequenceName): Promise<number> {
  const [table, col] = KEYED[seq];
  const [[row]] = await conn.query<RowDataPacket[]>(
    `SELECT GREATEST(s.next_id, (SELECT COALESCE(MAX(${col}), 0) + 1 FROM ${table})) AS id
       FROM id_sequence s WHERE s.seq_name = ? FOR UPDATE`, [seq]);
  if (!row) throw new Error(`Sequence ${seq} is missing (run migrations)`);
  const id = Number(row.id);
  await conn.query("UPDATE id_sequence SET next_id = ? WHERE seq_name = ?", [id + 1, seq]);
  return id;
}

export interface ObservedEffects {
  auditLog: Record<string, unknown>[];
  statusHistory: Record<string, unknown>[];
}

/**
 * Run an operation and return the audit_log and order_status_history rows that
 * appeared while it ran. Only the original triggers write those tables, so this
 * is how trigger effects are observed. On a shared server, rows written by
 * other sessions in the same window would be included too, and the UI says so.
 */
export async function observeEffects<T>(pool: Pool, fn: () => Promise<T>): Promise<{ result: T; effects: ObservedEffects }> {
  const [[mark]] = await pool.query<RowDataPacket[]>(
    "SELECT (SELECT COALESCE(MAX(audit_id), 0) FROM audit_log) a, (SELECT COALESCE(MAX(history_id), 0) FROM order_status_history) h");
  const result = await fn();
  const [audit] = await pool.query<RowDataPacket[]>("SELECT * FROM audit_log WHERE audit_id > ? ORDER BY audit_id", [mark!.a]);
  const [history] = await pool.query<RowDataPacket[]>("SELECT * FROM order_status_history WHERE history_id > ? ORDER BY history_id", [mark!.h]);
  return { result, effects: { auditLog: audit, statusHistory: history } };
}

export async function inTransaction<T>(pool: Pool, fn: (c: PoolConnection) => Promise<T>): Promise<T> {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const out = await fn(c);
    await c.commit();
    return out;
  } catch (e) {
    await c.rollback().catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
