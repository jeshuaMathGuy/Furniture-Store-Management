import type { RowDataPacket } from "mysql2";
import { roleHas } from "@furni/shared";
import type { Pool } from "../connection.js";
import { ForbiddenError, type AuthContext } from "../auth/authorize.js";

export interface RecordTable { table: string; note: string; rows: Record<string, unknown>[] }

/**
 * Raw relational view of one product for the "inspect record" panel.
 * Administrators and lab users only: it exposes supplier and stock internals.
 */
export async function productRecord(pool: Pool, ctx: AuthContext | null, productId: number): Promise<RecordTable[]> {
  if (!ctx || !(roleHas(ctx.roles, "product:manage") || roleHas(ctx.roles, "lab:read"))) throw new ForbiddenError();
  const rows = async (sql: string) => (await pool.query<RowDataPacket[]>(sql, [productId]))[0] as Record<string, unknown>[];
  const [product, supplier, inventory, offers, lines, provenance] = await Promise.all([
    rows("SELECT * FROM product WHERE product_id = ?"),
    rows("SELECT s.* FROM supplier s JOIN product p ON p.supplier_id = s.supplier_id WHERE p.product_id = ?"),
    rows("SELECT * FROM product_inventory WHERE product_id = ?"),
    rows("SELECT * FROM offer WHERE product_id = ? ORDER BY offer_id"),
    rows("SELECT order_id, product_id, quantity, unit_price, discount_pct, line_total FROM order_line WHERE product_id = ? ORDER BY order_id"),
    rows("SELECT * FROM data_provenance WHERE entity_name = 'product' AND entity_key = CAST(? AS CHAR)"),
  ]);
  return [
    { table: "product", note: "original table", rows: product },
    { table: "supplier", note: "original · via product.supplier_id", rows: supplier },
    { table: "product_inventory", note: "original · 1:1 on product_id", rows: inventory },
    { table: "offer", note: "original · offer.product_id", rows: offers },
    { table: "order_line", note: "original · order_line.product_id", rows: lines },
    { table: "data_provenance", note: "extension", rows: provenance },
  ];
}
