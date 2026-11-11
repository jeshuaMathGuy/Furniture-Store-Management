-- targets: app, lab
-- Teaching and reporting views. The source SQL declares none; these are FURNI / FORM additions.
-- They read ONLY original tables, so the same definitions work in the app DB and the lab sandbox.
-- They are ordinary (virtual) MySQL views and store no data of their own.

CREATE VIEW vw_product_catalog AS
SELECT p.product_id,
       p.product_name,
       p.list_price,
       p.is_active,
       s.supplier_id,
       s.supplier_name,
       i.qty_on_hand,
       i.reorder_point,
       (SELECT ROUND(AVG(f.rating),2) FROM feedback f WHERE f.product_id = p.product_id) AS average_rating,
       (SELECT COUNT(*) FROM feedback f WHERE f.product_id = p.product_id) AS review_count
FROM product p
JOIN supplier s ON s.supplier_id = p.supplier_id
LEFT JOIN product_inventory i ON i.product_id = p.product_id;

CREATE VIEW vw_customer_loyalty AS
SELECT c.customer_id,
       c.customer_name,
       COALESCE((SELECT SUM(a.points_awarded) FROM loyalty_award a WHERE a.customer_id = c.customer_id), 0) AS loyalty_points,
       (SELECT COUNT(*) FROM sales_order o WHERE o.customer_id = c.customer_id AND o.order_status = 'delivered') AS delivered_orders
FROM customer c;

-- requested_qty reproduces sp_queue_reorders' expression exactly.
CREATE VIEW vw_low_stock AS
SELECT i.product_id,
       p.product_name,
       i.qty_on_hand,
       i.reorder_point,
       i.reorder_qty,
       GREATEST(i.reorder_qty, i.reorder_point - i.qty_on_hand) AS requested_qty
FROM product_inventory i
JOIN product p ON p.product_id = i.product_id
WHERE i.qty_on_hand <= i.reorder_point;

CREATE VIEW vw_order_summary AS
SELECT o.order_id,
       o.order_date,
       o.order_status,
       c.customer_id,
       c.customer_name,
       COUNT(l.product_id) AS line_count,
       COALESCE(SUM(l.quantity), 0) AS item_count,
       COALESCE(ROUND(SUM(l.line_total),2), 0) AS order_total
FROM sales_order o
JOIN customer c ON c.customer_id = o.customer_id
LEFT JOIN order_line l ON l.order_id = o.order_id
GROUP BY o.order_id, o.order_date, o.order_status, c.customer_id, c.customer_name;

CREATE VIEW vw_supplier_performance AS
SELECT s.supplier_id,
       s.supplier_name,
       (SELECT COUNT(*) FROM product p WHERE p.supplier_id = s.supplier_id) AS product_count,
       (SELECT COALESCE(ROUND(SUM(l.line_total),2),0)
          FROM order_line l
          JOIN product p ON p.product_id = l.product_id
          JOIN sales_order o ON o.order_id = l.order_id
         WHERE p.supplier_id = s.supplier_id AND o.order_status = 'delivered') AS delivered_revenue,
       (SELECT ROUND(AVG(f.rating),2)
          FROM feedback f JOIN product p ON p.product_id = f.product_id
         WHERE p.supplier_id = s.supplier_id) AS average_rating,
       (SELECT COUNT(*) FROM supplier_certification c WHERE c.supplier_id = s.supplier_id) AS certification_count,
       (SELECT COUNT(*) FROM supplier_service_region r WHERE r.supplier_id = s.supplier_id) AS region_count
FROM supplier s;
