import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import type { Pool } from "../connection.js";

export const CatalogFilterSchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.enum(["living", "dining", "bedroom", "office", "storage"]).optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  inStockOnly: z.coerce.boolean().optional(),
  sort: z.enum(["name", "price_asc", "price_desc", "rating"]).default("name"),
  /** Offers are evaluated as of this date (not CURRENT_DATE) so results are reproducible. */
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type CatalogFilter = z.input<typeof CatalogFilterSchema>;

export interface CatalogItem {
  productId: number;
  name: string;
  supplierId: number;
  supplierName: string;
  listPrice: string;
  offerPrice: string | null;
  offerName: string | null;
  category: string | null;
  room: string | null;
  material: string | null;
  modelKey: string | null;
  qtyOnHand: number;
  averageRating: string | null;
  reviewCount: number;
  provenance: "original_sql" | "demo_seed" | null;
}

const SORT: Record<string, string> = {
  name: "p.product_name ASC",
  price_asc: "COALESCE(o.offer_price, p.list_price) ASC, p.product_id",
  price_desc: "COALESCE(o.offer_price, p.list_price) DESC, p.product_id",
  rating: "average_rating IS NULL, average_rating DESC, p.product_id",
};

export async function listProducts(pool: Pool, input: CatalogFilter): Promise<CatalogItem[]> {
  const f = CatalogFilterSchema.parse(input);
  const where: string[] = ["p.is_active = TRUE"];
  const params: unknown[] = [f.asOf];
  if (f.q) { where.push("(p.product_name LIKE ? OR d.primary_material LIKE ?)"); params.push(`%${f.q}%`, `%${f.q}%`); }
  if (f.category) { where.push("d.category_code = ?"); params.push(f.category); }
  if (f.supplierId) { where.push("p.supplier_id = ?"); params.push(f.supplierId); }
  if (f.minPrice !== undefined) { where.push("COALESCE(o.offer_price, p.list_price) >= ?"); params.push(f.minPrice); }
  if (f.maxPrice !== undefined) { where.push("COALESCE(o.offer_price, p.list_price) <= ?"); params.push(f.maxPrice); }
  if (f.inStockOnly) where.push("COALESCE(i.qty_on_hand,0) > 0");

  // Best active offer per product, priced by the original stored function.
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.product_id, p.product_name, p.supplier_id, s.supplier_name, p.list_price,
            o.offer_price, o.offer_name, d.category_code, d.room, d.primary_material, d.model_key,
            COALESCE(i.qty_on_hand,0) AS qty_on_hand,
            (SELECT ROUND(AVG(fb.rating),2) FROM feedback fb WHERE fb.product_id=p.product_id) AS average_rating,
            (SELECT COUNT(*) FROM feedback fb WHERE fb.product_id=p.product_id) AS review_count,
            dp.source AS provenance
       FROM product p
       JOIN supplier s ON s.supplier_id = p.supplier_id
       LEFT JOIN product_detail d ON d.product_id = p.product_id
       LEFT JOIN product_inventory i ON i.product_id = p.product_id
       LEFT JOIN data_provenance dp ON dp.entity_name='product' AND dp.entity_key = CAST(p.product_id AS CHAR)
       LEFT JOIN (
         SELECT x.product_id, x.offer_name, x.offer_price FROM (
           SELECT ofr.product_id, ofr.offer_name,
                  fn_discounted_price(pp.list_price, ofr.discount_pct) AS offer_price,
                  ROW_NUMBER() OVER (PARTITION BY ofr.product_id ORDER BY ofr.discount_pct DESC, ofr.offer_id) AS rn
             FROM offer ofr JOIN product pp ON pp.product_id = ofr.product_id
            WHERE ofr.is_active = TRUE AND ? BETWEEN ofr.start_date AND ofr.end_date) x
          WHERE x.rn = 1) o ON o.product_id = p.product_id
      WHERE ${where.join(" AND ")}
      ORDER BY ${SORT[f.sort]}`,
    params);
  return rows.map((r) => ({
    productId: r.product_id, name: r.product_name, supplierId: r.supplier_id, supplierName: r.supplier_name,
    listPrice: r.list_price, offerPrice: r.offer_price, offerName: r.offer_name, category: r.category_code,
    room: r.room, material: r.primary_material, modelKey: r.model_key, qtyOnHand: Number(r.qty_on_hand),
    averageRating: r.average_rating, reviewCount: Number(r.review_count), provenance: r.provenance,
  }));
}
