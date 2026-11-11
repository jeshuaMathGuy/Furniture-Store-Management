-- Reference data (app DB). Idempotent: safe to re-run.

INSERT INTO app_role (role_code, role_name, description) VALUES
('customer','Customer','Browse, configure, purchase, review; own orders and loyalty only'),
('administrator','Administrator','Manage catalog, customers, suppliers, orders, offers, settlements, reports'),
('warehouse','Warehouse operator','Inventory, goods receipts, order confirmation, replenishment'),
('supplier','Supplier','Own products, capabilities, receipts and settlements'),
('student','Student / Instructor','Database laboratory scenarios on the isolated sandbox')
ON DUPLICATE KEY UPDATE role_name=VALUES(role_name), description=VALUES(description);

INSERT INTO product_category (category_code, category_name, sort_order) VALUES
('living','Living',1),('dining','Dining',2),('bedroom','Bedroom',3),('office','Office',4),('storage','Storage',5)
ON DUPLICATE KEY UPDATE category_name=VALUES(category_name), sort_order=VALUES(sort_order);

-- Tag every row that came from the authoritative source script.
INSERT IGNORE INTO data_provenance (entity_name, entity_key, source)
SELECT 'customer', CAST(customer_id AS CHAR), 'original_sql' FROM customer
UNION ALL SELECT 'supplier', CAST(supplier_id AS CHAR), 'original_sql' FROM supplier
UNION ALL SELECT 'product', CAST(product_id AS CHAR), 'original_sql' FROM product
UNION ALL SELECT 'sales_order', CAST(order_id AS CHAR), 'original_sql' FROM sales_order
UNION ALL SELECT 'offer', CAST(offer_id AS CHAR), 'original_sql' FROM offer
UNION ALL SELECT 'goods_receipt', CAST(receipt_id AS CHAR), 'original_sql' FROM goods_receipt
UNION ALL SELECT 'warranty_plan', plan_code, 'original_sql' FROM warranty_plan;
