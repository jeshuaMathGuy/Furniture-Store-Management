-- One default delivery address per original customer, in their recorded postal area.
-- Demonstration data (tagged in data_provenance). Idempotent.

INSERT INTO shipping_address (customer_id, line1, line2, postal_code, is_default)
SELECT c.customer_id, CONCAT(c.customer_id * 12, ' Residency Road'), NULL, c.postal_code, TRUE
FROM customer c
WHERE NOT EXISTS (SELECT 1 FROM shipping_address a WHERE a.customer_id = c.customer_id);

INSERT IGNORE INTO data_provenance (entity_name, entity_key, source, note)
SELECT 'shipping_address', CAST(address_id AS CHAR), 'demo_seed', 'Demo delivery address' FROM shipping_address;

INSERT INTO demo_scenario (scenario_id, title, category, description, is_mutating) VALUES
('commerce.checkout', 'Checkout to placed order', 'trigger', 'Draft order, lines (bi_order_line), simulated payment, then draft to placed (bu/au_sales_order).', TRUE)
ON DUPLICATE KEY UPDATE title = VALUES(title), description = VALUES(description);
