/** Guided examples for the read-only SQL playground. Every one must pass the classifier (tested). */
export interface LabQuery { id: string; title: string; concept: string; sql: string; explanation: string; inputs: string[] }

export const LAB_QUERIES: LabQuery[] = [
  {
    id: "join-where-order", title: "Orders with customers", concept: "INNER JOIN, WHERE, ORDER BY",
    sql: `SELECT o.order_id, o.order_date, o.order_status, c.customer_name, pa.city
FROM sales_order o
JOIN customer c ON c.customer_id = o.customer_id
JOIN postal_area pa ON pa.postal_code = c.postal_code
WHERE o.order_status <> 'cancelled'
ORDER BY o.order_date DESC;`,
    explanation: "Each order is matched to exactly one customer and postal area through foreign keys; WHERE filters rows before ORDER BY sorts them.",
    inputs: ["sales_order", "customer", "postal_area"],
  },
  {
    id: "group-having", title: "Revenue per supplier", concept: "GROUP BY, aggregates, HAVING",
    sql: `SELECT p.supplier_id, COUNT(*) AS line_count, SUM(l.quantity) AS units, ROUND(SUM(l.line_total), 2) AS revenue
FROM order_line l
JOIN product p ON p.product_id = l.product_id
GROUP BY p.supplier_id
HAVING SUM(l.line_total) > 50000;`,
    explanation: "Lines are grouped per supplier, aggregated, and HAVING filters whole groups after aggregation (WHERE could not refer to SUM).",
    inputs: ["order_line", "product"],
  },
  {
    id: "left-join", title: "Products and their offers", concept: "LEFT JOIN",
    sql: `SELECT p.product_id, p.product_name, o.offer_name, o.discount_pct
FROM product p
LEFT JOIN offer o ON o.product_id = p.product_id
ORDER BY p.product_id;`,
    explanation: "Every product appears; products without an offer (102) get NULLs in the offer columns.",
    inputs: ["product", "offer"],
  },
  {
    id: "correlated", title: "Above their supplier's average price", concept: "Correlated subquery",
    sql: `SELECT p.product_id, p.product_name, p.supplier_id, p.list_price
FROM product p
WHERE p.list_price > (SELECT AVG(p2.list_price) FROM product p2 WHERE p2.supplier_id = p.supplier_id);`,
    explanation: "Logically, the inner query is evaluated once per outer row using that row's supplier_id. MySQL's optimizer may rewrite it (for example into a join with a derived table), so this describes the meaning, not the physical plan.",
    inputs: ["product"],
  },
  {
    id: "exists-in", title: "EXISTS, NOT EXISTS and IN", concept: "EXISTS / NOT EXISTS / IN",
    sql: `SELECT p.product_id, p.product_name
FROM product p
WHERE NOT EXISTS (SELECT 1 FROM offer o WHERE o.product_id = p.product_id)
  AND EXISTS (SELECT 1 FROM order_line l WHERE l.product_id = p.product_id)
  AND p.supplier_id IN (SELECT supplier_id FROM supplier_certification WHERE certification = 'FSC');`,
    explanation: "Products that have been ordered, have no offer, and come from an FSC-certified supplier. Beware NOT IN with a subquery that can return NULL: it then matches nothing.",
    inputs: ["product", "offer", "order_line", "supplier_certification"],
  },
  {
    id: "cte-window", title: "Order totals with ranking", concept: "CTE and window functions",
    sql: `WITH order_totals AS (
  SELECT order_id, SUM(line_total) AS total FROM order_line GROUP BY order_id
)
SELECT o.order_id, c.customer_name, t.total,
       RANK() OVER (ORDER BY t.total DESC) AS revenue_rank,
       SUM(t.total) OVER (ORDER BY o.order_date) AS running_total
FROM order_totals t
JOIN sales_order o ON o.order_id = t.order_id
JOIN customer c ON c.customer_id = o.customer_id;`,
    explanation: "The CTE names an intermediate relation. Window functions compute a rank and a running total without collapsing rows the way GROUP BY does.",
    inputs: ["order_line", "sales_order", "customer"],
  },
  {
    id: "views-functions", title: "Views and stored functions", concept: "vw_* views, fn_discounted_price, fn_warranty_expiry",
    sql: `SELECT v.product_id, v.product_name, v.list_price, v.qty_on_hand, v.average_rating,
       fn_discounted_price(v.list_price, 10) AS price_after_10pct,
       fn_warranty_expiry('2026-11-12', 24) AS warranty_24m
FROM vw_product_catalog v
UNION ALL
SELECT product_id, product_name, NULL, qty_on_hand, NULL, NULL, NULL FROM vw_low_stock;`,
    explanation: "Views are stored SELECTs read like tables (others: vw_order_summary, vw_customer_loyalty, vw_supplier_performance). The two deterministic functions are the only routines lab_reader may execute. UNION ALL appends low-stock rows.",
    inputs: ["vw_product_catalog", "vw_low_stock"],
  },
  {
    id: "metadata", title: "Constraints from information_schema", concept: "Metadata",
    sql: `SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE
FROM information_schema.TABLE_CONSTRAINTS
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME, CONSTRAINT_TYPE;`,
    explanation: "Primary keys, unique keys, foreign keys and CHECK constraints of the sandbox, read from the data dictionary.",
    inputs: ["information_schema.TABLE_CONSTRAINTS"],
  },
];
