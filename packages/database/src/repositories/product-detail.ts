import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import type { Pool } from "../connection.js";
import { CatalogFilterSchema, listProducts, type CatalogItem } from "./catalog.js";

export interface ProductDetail extends CatalogItem {
  description: string | null;
  style: string | null;
  dimensions: { widthCm: number; depthCm: number; heightCm: number } | null;
  modelKey: string | null;
  offerEnds: string | null;
  discountPct: string | null;
  variants: { variantId: number; name: string; material: string; colorHex: string; priceDelta: string; qtyOnHand: number }[];
  reviews: { rating: number; comment: string | null; date: string; customerFirstName: string }[];
  warrantyMonths: number[];
  certifications: string[];
}

const AsOf = CatalogFilterSchema.shape.asOf;

export async function getProduct(pool: Pool, productId: number, asOf: string): Promise<ProductDetail | null> {
  const id = z.coerce.number().int().positive().parse(productId);
  const day = AsOf.parse(asOf);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.product_id, p.product_name, p.supplier_id, s.supplier_name, p.list_price,
            d.category_code, d.room, d.primary_material, d.style, d.description,
            d.width_cm, d.depth_cm, d.height_cm, d.model_key,
            COALESCE(i.qty_on_hand,0) qty_on_hand, dp.source provenance,
            (SELECT ROUND(AVG(f.rating),2) FROM feedback f WHERE f.product_id=p.product_id) average_rating,
            (SELECT COUNT(*) FROM feedback f WHERE f.product_id=p.product_id) review_count
       FROM product p JOIN supplier s ON s.supplier_id=p.supplier_id
       LEFT JOIN product_detail d ON d.product_id=p.product_id
       LEFT JOIN product_inventory i ON i.product_id=p.product_id
       LEFT JOIN data_provenance dp ON dp.entity_name='product' AND dp.entity_key=CAST(p.product_id AS CHAR)
      WHERE p.product_id=? AND p.is_active=TRUE`, [id]);
  const r = rows[0];
  if (!r) return null;
  const [[offer], [variants], [reviews], [plans], [certs]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT o.offer_name, o.discount_pct, o.end_date, fn_discounted_price(?, o.discount_pct) offer_price
         FROM offer o WHERE o.product_id=? AND o.is_active=TRUE AND ? BETWEEN o.start_date AND o.end_date
        ORDER BY o.discount_pct DESC, o.offer_id LIMIT 1`, [r.list_price, id, day]),
    pool.query<RowDataPacket[]>(
      `SELECT v.variant_id, v.variant_name, v.material, v.color_hex, v.price_delta, COALESCE(vi.qty_on_hand,0) qty
         FROM product_variant v LEFT JOIN product_variant_inventory vi ON vi.variant_id=v.variant_id
        WHERE v.product_id=? AND v.is_active=TRUE ORDER BY v.variant_id`, [id]),
    // Only the reviewer's first name is exposed publicly.
    pool.query<RowDataPacket[]>(
      `SELECT f.rating, f.comment, f.feedback_date, SUBSTRING_INDEX(c.customer_name,' ',1) first_name
         FROM feedback f JOIN customer c ON c.customer_id=f.customer_id WHERE f.product_id=? ORDER BY f.feedback_date DESC`, [id]),
    pool.query<RowDataPacket[]>("SELECT DISTINCT warranty_months FROM warranty_plan WHERE supplier_id=? ORDER BY 1", [r.supplier_id]),
    pool.query<RowDataPacket[]>("SELECT certification FROM supplier_certification WHERE supplier_id=? ORDER BY 1", [r.supplier_id]),
  ]);
  const o = offer[0];
  return {
    productId: r.product_id, name: r.product_name, supplierId: r.supplier_id, supplierName: r.supplier_name,
    listPrice: r.list_price, offerPrice: o?.offer_price ?? null, offerName: o?.offer_name ?? null,
    offerEnds: o?.end_date ?? null, discountPct: o?.discount_pct ?? null,
    category: r.category_code, room: r.room, material: r.primary_material, style: r.style, description: r.description,
    dimensions: r.width_cm ? { widthCm: r.width_cm, depthCm: r.depth_cm, heightCm: r.height_cm } : null,
    modelKey: r.model_key, qtyOnHand: Number(r.qty_on_hand), averageRating: r.average_rating,
    reviewCount: Number(r.review_count), provenance: r.provenance,
    variants: variants.map((v) => ({
      variantId: v.variant_id, name: v.variant_name, material: v.material,
      colorHex: v.color_hex, priceDelta: v.price_delta, qtyOnHand: Number(v.qty),
    })),
    reviews: reviews.map((f) => ({ rating: f.rating, comment: f.comment, date: f.feedback_date, customerFirstName: f.first_name })),
    warrantyMonths: plans.map((p) => p.warranty_months as number),
    certifications: certs.map((c) => c.certification as string),
  };
}

/** Same category first, then same room; never the product itself. */
export async function relatedProducts(pool: Pool, productId: number, asOf: string, limit = 4): Promise<CatalogItem[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT d2.product_id FROM product_detail d1
       JOIN product_detail d2 ON d2.product_id <> d1.product_id
       JOIN product p ON p.product_id = d2.product_id AND p.is_active = TRUE
      WHERE d1.product_id = ? AND (d2.category_code = d1.category_code OR d2.room = d1.room)
      ORDER BY (d2.category_code = d1.category_code) DESC, d2.product_id LIMIT ?`, [productId, limit]);
  const order = rows.map((x) => x.product_id as number);
  const all = await listProducts(pool, { asOf });
  return order.map((id) => all.find((p) => p.productId === id)).filter((p): p is CatalogItem => !!p);
}

export async function filterOptions(pool: Pool) {
  const [[cats], [sups], [range]] = await Promise.all([
    pool.query<RowDataPacket[]>("SELECT category_code code, category_name name FROM product_category ORDER BY sort_order"),
    pool.query<RowDataPacket[]>(
      `SELECT s.supplier_id id, s.supplier_name name FROM supplier s
        WHERE EXISTS (SELECT 1 FROM product p WHERE p.supplier_id = s.supplier_id AND p.is_active) ORDER BY s.supplier_name`),
    pool.query<RowDataPacket[]>("SELECT MIN(list_price) lo, MAX(list_price) hi FROM product WHERE is_active"),
  ]);
  return {
    categories: cats.map((c) => ({ code: c.code as string, name: c.name as string })),
    suppliers: sups.map((s) => ({ id: s.id as number, name: s.name as string })),
    priceRange: { min: Number(range[0]?.lo ?? 0), max: Number(range[0]?.hi ?? 0) },
  };
}
