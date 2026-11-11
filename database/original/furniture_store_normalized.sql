DROP DATABASE IF EXISTS furniture_store_db;
CREATE DATABASE furniture_store_db CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE furniture_store_db;
DROP TEMPORARY TABLE IF EXISTS
    unf_customer,
    unf_supplier,
    unf_product,
    unf_sales_order,
    nf1_order_line,
    nf1_supplier_capability,
    nf2_order,
    nf2_product,
    nf2_order_line,
    nf2_supplier_capability,
    nf3_order_supplier_plan,
    nf3_supplier_capability,
    nf3_supplier_capability_check,
    nf3_order_supplier_plan_check;

CREATE TABLE customer (
    customer_id INT PRIMARY KEY,
    customer_name VARCHAR(120) NOT NULL,
    email VARCHAR(160) NOT NULL UNIQUE,
    postal_code VARCHAR(12) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE supplier (
    supplier_id INT PRIMARY KEY,
    supplier_name VARCHAR(120) NOT NULL UNIQUE,
    phone VARCHAR(24) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE product (
    product_id INT PRIMARY KEY,
    product_name VARCHAR(140) NOT NULL,
    supplier_id INT NOT NULL,
    list_price DECIMAL(12,2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_product_price CHECK (list_price >= 0),
    CONSTRAINT fk_product_supplier FOREIGN KEY (supplier_id)
        REFERENCES supplier(supplier_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    INDEX idx_product_supplier (supplier_id)
) ENGINE=InnoDB;

CREATE TABLE sales_order (
    order_id INT PRIMARY KEY,
    customer_id INT NOT NULL,
    order_date DATETIME NOT NULL,
    order_status ENUM('draft','placed','confirmed','shipped','delivered','cancelled') NOT NULL,
    CONSTRAINT fk_order_customer FOREIGN KEY (customer_id)
        REFERENCES customer(customer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    INDEX idx_order_customer_date (customer_id, order_date),
    INDEX idx_order_status_date (order_status, order_date)
) ENGINE=InnoDB;

CREATE TEMPORARY TABLE unf_customer (
    customer_id INT PRIMARY KEY,
    customer_name VARCHAR(120) NOT NULL,
    customer_email VARCHAR(160) NOT NULL,
    postal_code VARCHAR(12) NOT NULL,
    city VARCHAR(80) NOT NULL,
    region VARCHAR(80) NOT NULL,
    is_active BOOLEAN NOT NULL
);

CREATE TEMPORARY TABLE unf_supplier (
    supplier_id INT PRIMARY KEY,
    supplier_name VARCHAR(120) NOT NULL,
    supplier_phone VARCHAR(24) NOT NULL,
    certifications JSON NOT NULL,
    service_regions JSON NOT NULL,
    is_active BOOLEAN NOT NULL
);

CREATE TEMPORARY TABLE unf_product (
    product_id INT PRIMARY KEY,
    product_name VARCHAR(140) NOT NULL,
    supplier_id INT NOT NULL,
    supplier_name VARCHAR(120) NOT NULL,
    supplier_phone VARCHAR(24) NOT NULL,
    list_price DECIMAL(12,2) NOT NULL,
    is_active BOOLEAN NOT NULL
);

CREATE TEMPORARY TABLE unf_sales_order (
    order_id INT PRIMARY KEY,
    order_date DATETIME NOT NULL,
    customer_id INT NOT NULL,
    customer_name VARCHAR(120) NOT NULL,
    customer_email VARCHAR(160) NOT NULL,
    postal_code VARCHAR(12) NOT NULL,
    city VARCHAR(80) NOT NULL,
    region VARCHAR(80) NOT NULL,
    order_status ENUM('draft','placed','confirmed','shipped','delivered','cancelled') NOT NULL,
    items JSON NOT NULL
);

INSERT INTO unf_customer VALUES
(1,'Asha Rao','asha.rao@example.com','560001','Bengaluru','Karnataka',TRUE),
(2,'Dev Shah','dev.shah@example.com','400001','Mumbai','Maharashtra',TRUE),
(3,'Mira Nair','mira.nair@example.com','560001','Bengaluru','Karnataka',TRUE);

INSERT INTO unf_supplier VALUES
(10,'CedarWorks','0804000100',JSON_ARRAY('FSC','ISO9001'),JSON_ARRAY('Karnataka','Goa'),TRUE),
(20,'UrbanNest','0224000200',JSON_ARRAY('BIFMA','FSC'),JSON_ARRAY('Maharashtra','Gujarat'),TRUE);

INSERT INTO unf_product VALUES
(101,'Oak Executive Desk',10,'CedarWorks','0804000100',45000,TRUE),
(102,'Ergonomic Oak Chair',10,'CedarWorks','0804000100',12000,TRUE),
(201,'Modular Fabric Sofa',20,'UrbanNest','0224000200',68000,TRUE),
(202,'Solid Wood Dining Table',20,'UrbanNest','0224000200',38000,TRUE);

INSERT INTO unf_sales_order VALUES
(5001,'2026-11-01 10:00:00',1,'Asha Rao','asha.rao@example.com','560001','Bengaluru','Karnataka','placed',
 JSON_ARRAY(
  JSON_OBJECT('product_id',101,'quantity',1,'unit_price',44000,'plan_code','CEDAR36','warranty_months',36),
  JSON_OBJECT('product_id',102,'quantity',2,'unit_price',11500,'plan_code','CEDAR36','warranty_months',36)
  )),
(5002,'2026-11-02 12:30:00',2,'Dev Shah','dev.shah@example.com','400001','Mumbai','Maharashtra','delivered',
 JSON_ARRAY(
  JSON_OBJECT('product_id',201,'quantity',1,'unit_price',65000,'plan_code','URBAN24','warranty_months',24)
  )),
(5003,'2026-11-03 15:15:00',3,'Mira Nair','mira.nair@example.com','560001','Bengaluru','Karnataka','delivered',
 JSON_ARRAY(
  JSON_OBJECT('product_id',202,'quantity',1,'unit_price',37000,'plan_code','URBAN24','warranty_months',24)
  ));

CREATE TEMPORARY TABLE nf1_order_line (
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    order_date DATETIME NOT NULL,
    customer_id INT NOT NULL,
    customer_name VARCHAR(120) NOT NULL,
    customer_email VARCHAR(160) NOT NULL,
    postal_code VARCHAR(12) NOT NULL,
    city VARCHAR(80) NOT NULL,
    region VARCHAR(80) NOT NULL,
    product_name VARCHAR(140) NOT NULL,
    supplier_id INT NOT NULL,
    supplier_name VARCHAR(120) NOT NULL,
    supplier_phone VARCHAR(24) NOT NULL,
    product_list_price DECIMAL(12,2) NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    plan_code VARCHAR(24) NOT NULL,
    warranty_months INT NOT NULL,
    PRIMARY KEY (order_id, product_id)
);

INSERT INTO nf1_order_line
SELECT o.order_id,j.product_id,o.order_date,o.customer_id,o.customer_name,o.customer_email,
       o.postal_code,o.city,o.region,p.product_name,p.supplier_id,p.supplier_name,
       p.supplier_phone,p.list_price,j.quantity,j.unit_price,j.plan_code,j.warranty_months
FROM unf_sales_order o
CROSS JOIN JSON_TABLE(o.items,'$[*]' COLUMNS (
    product_id INT PATH '$.product_id',
    quantity INT PATH '$.quantity',
    unit_price DECIMAL(12,2) PATH '$.unit_price',
    plan_code VARCHAR(24) PATH '$.plan_code',
    warranty_months INT PATH '$.warranty_months'
)) j
JOIN unf_product p ON p.product_id=j.product_id;

CREATE TEMPORARY TABLE nf1_supplier_capability (
    supplier_id INT NOT NULL,
    certification VARCHAR(50) NOT NULL,
    service_region VARCHAR(80) NOT NULL,
    PRIMARY KEY (supplier_id, certification, service_region)
);

INSERT INTO nf1_supplier_capability
SELECT s.supplier_id,c.certification,r.service_region
FROM unf_supplier s
CROSS JOIN JSON_TABLE(s.certifications,'$[*]' COLUMNS (
    certification VARCHAR(50) PATH '$'
)) c
CROSS JOIN JSON_TABLE(s.service_regions,'$[*]' COLUMNS (
    service_region VARCHAR(80) PATH '$'
)) r;

CREATE TEMPORARY TABLE nf2_order (
    order_id INT PRIMARY KEY,
    order_date DATETIME NOT NULL,
    customer_id INT NOT NULL,
    customer_name VARCHAR(120) NOT NULL,
    customer_email VARCHAR(160) NOT NULL,
    postal_code VARCHAR(12) NOT NULL,
    city VARCHAR(80) NOT NULL,
    region VARCHAR(80) NOT NULL,
    order_status VARCHAR(20) NOT NULL
);

INSERT INTO nf2_order
SELECT DISTINCT order_id,order_date,customer_id,customer_name,customer_email,
       postal_code,city,region,order_status
FROM unf_sales_order;

CREATE TEMPORARY TABLE nf2_product (
    product_id INT PRIMARY KEY,
    product_name VARCHAR(140) NOT NULL,
    supplier_id INT NOT NULL,
    supplier_name VARCHAR(120) NOT NULL,
    supplier_phone VARCHAR(24) NOT NULL,
    list_price DECIMAL(12,2) NOT NULL,
    is_active BOOLEAN NOT NULL
);

INSERT INTO nf2_product
SELECT
    product_id,
    product_name,
    supplier_id,
    supplier_name,
    supplier_phone,
    list_price,
    is_active
FROM unf_product;

CREATE TEMPORARY TABLE nf2_order_line (
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    plan_code VARCHAR(24) NOT NULL,
    warranty_months INT NOT NULL,
    PRIMARY KEY (order_id, product_id)
);

INSERT INTO nf2_order_line
SELECT order_id,product_id,quantity,unit_price,plan_code,warranty_months
FROM nf1_order_line;

CREATE TEMPORARY TABLE nf2_supplier_capability (
    supplier_id INT NOT NULL,
    certification VARCHAR(50) NOT NULL,
    service_region VARCHAR(80) NOT NULL,
    PRIMARY KEY (supplier_id, certification, service_region)
);

INSERT INTO nf2_supplier_capability
SELECT supplier_id,certification,service_region
FROM nf1_supplier_capability;

CREATE TABLE postal_area (
    postal_code VARCHAR(12) PRIMARY KEY,
    city VARCHAR(80) NOT NULL,
    region VARCHAR(80) NOT NULL
) ENGINE=InnoDB;

INSERT INTO postal_area
SELECT DISTINCT postal_code,city,region FROM nf2_order;

INSERT INTO customer (customer_id,customer_name,email,postal_code,is_active)
SELECT customer_id,customer_name,customer_email,postal_code,TRUE
FROM unf_customer;

INSERT INTO supplier (supplier_id,supplier_name,phone,is_active)
SELECT supplier_id,supplier_name,supplier_phone,is_active
FROM unf_supplier;

INSERT INTO product (product_id,product_name,supplier_id,list_price,is_active)
SELECT product_id,product_name,supplier_id,list_price,is_active
FROM nf2_product;

INSERT INTO sales_order (order_id,customer_id,order_date,order_status)
SELECT order_id,customer_id,order_date,order_status
FROM nf2_order;

ALTER TABLE customer
    ADD CONSTRAINT fk_customer_postal FOREIGN KEY (postal_code)
    REFERENCES postal_area(postal_code) ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE TABLE order_line (
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
    line_total DECIMAL(14,2) GENERATED ALWAYS AS
        (ROUND(quantity*unit_price*(1-discount_pct/100),2)) STORED,
    PRIMARY KEY (order_id,product_id),
    CONSTRAINT chk_line_quantity CHECK (quantity > 0),
    CONSTRAINT chk_line_price CHECK (unit_price >= 0),
    CONSTRAINT chk_line_discount CHECK (discount_pct BETWEEN 0 AND 100),
    CONSTRAINT fk_line_order FOREIGN KEY (order_id)
        REFERENCES sales_order(order_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_line_product FOREIGN KEY (product_id)
        REFERENCES product(product_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    INDEX idx_line_product (product_id)
) ENGINE=InnoDB;

INSERT INTO order_line (order_id,product_id,quantity,unit_price)
SELECT order_id,product_id,quantity,unit_price
FROM nf2_order_line;

CREATE TABLE warranty_plan (
    plan_code VARCHAR(24) PRIMARY KEY,
    supplier_id INT NOT NULL,
    warranty_months INT NOT NULL,
    CONSTRAINT chk_warranty_months CHECK (warranty_months BETWEEN 0 AND 120),
    CONSTRAINT fk_plan_supplier FOREIGN KEY (supplier_id)
        REFERENCES supplier(supplier_id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO warranty_plan (plan_code,supplier_id,warranty_months)
SELECT DISTINCT plan_code,supplier_id,warranty_months
FROM nf1_order_line;

CREATE TEMPORARY TABLE nf3_order_supplier_plan (
    order_id INT NOT NULL,
    supplier_id INT NOT NULL,
    plan_code VARCHAR(24) NOT NULL,
    PRIMARY KEY (order_id,supplier_id),
    UNIQUE KEY uq_order_plan (order_id,plan_code)
);

INSERT INTO nf3_order_supplier_plan (order_id,supplier_id,plan_code)
SELECT DISTINCT n.order_id,p.supplier_id,n.plan_code
FROM nf1_order_line n
JOIN product p ON p.product_id=n.product_id;

CREATE TEMPORARY TABLE nf3_supplier_capability (
    supplier_id INT NOT NULL,
    certification VARCHAR(50) NOT NULL,
    service_region VARCHAR(80) NOT NULL,
    PRIMARY KEY (supplier_id,certification,service_region)
);

INSERT INTO nf3_supplier_capability
SELECT supplier_id,certification,service_region
FROM nf2_supplier_capability;

CREATE TABLE order_plan (
    order_id INT NOT NULL,
    plan_code VARCHAR(24) NOT NULL,
    PRIMARY KEY (order_id,plan_code),
    CONSTRAINT fk_order_plan_order FOREIGN KEY (order_id)
        REFERENCES sales_order(order_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_order_plan_code FOREIGN KEY (plan_code)
        REFERENCES warranty_plan(plan_code) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO order_plan (order_id,plan_code)
SELECT DISTINCT order_id,plan_code
FROM nf3_order_supplier_plan;

CREATE TABLE supplier_certification (
    supplier_id INT NOT NULL,
    certification VARCHAR(50) NOT NULL,
    PRIMARY KEY (supplier_id,certification),
    CONSTRAINT fk_cert_supplier FOREIGN KEY (supplier_id)
        REFERENCES supplier(supplier_id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE supplier_service_region (
    supplier_id INT NOT NULL,
    service_region VARCHAR(80) NOT NULL,
    PRIMARY KEY (supplier_id,service_region),
    CONSTRAINT fk_region_supplier FOREIGN KEY (supplier_id)
        REFERENCES supplier(supplier_id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT INTO supplier_certification
SELECT DISTINCT supplier_id,certification
FROM nf3_supplier_capability;

INSERT INTO supplier_service_region
SELECT DISTINCT supplier_id,service_region
FROM nf3_supplier_capability;

CREATE TABLE offer (
    offer_id INT PRIMARY KEY,
    product_id INT NOT NULL,
    offer_name VARCHAR(120) NOT NULL,
    discount_pct DECIMAL(5,2) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_offer_discount CHECK (discount_pct BETWEEN 0 AND 100),
    CONSTRAINT chk_offer_dates CHECK (end_date >= start_date),
    CONSTRAINT fk_offer_product FOREIGN KEY (product_id)
        REFERENCES product(product_id) ON DELETE CASCADE,
    INDEX idx_offer_dates (is_active,start_date,end_date)
) ENGINE=InnoDB;

CREATE TABLE feedback (
    feedback_id INT PRIMARY KEY,
    customer_id INT NOT NULL,
    product_id INT NOT NULL,
    rating TINYINT NOT NULL,
    comment VARCHAR(500),
    feedback_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_customer_product_feedback (customer_id,product_id),
    CONSTRAINT chk_feedback_rating CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT fk_feedback_customer FOREIGN KEY (customer_id)
        REFERENCES customer(customer_id) ON DELETE CASCADE,
    CONSTRAINT fk_feedback_product FOREIGN KEY (product_id)
        REFERENCES product(product_id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT INTO offer VALUES
(1,101,'Executive Desk Launch',10,'2026-11-01','2026-11-30',TRUE),
(2,201,'Living Room Refresh',8.5,'2026-11-01','2026-11-15',TRUE),
(3,202,'Dining Collection',12,'2026-11-03','2026-11-20',TRUE);

INSERT INTO feedback (feedback_id,customer_id,product_id,rating,comment,feedback_date) VALUES
(1,1,101,5,'Excellent finish and sturdy construction','2026-11-02 14:00:00'),
(2,2,201,4,'Comfortable sofa with good fabric quality','2026-11-03 16:30:00'),
(3,3,202,4,'Solid dining table and clean finish','2026-11-04 11:15:00');

CREATE TABLE order_status_history (
    history_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    order_status ENUM('draft','placed','confirmed','shipped','delivered','cancelled') NOT NULL,
    changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    remarks VARCHAR(255),
    CONSTRAINT fk_history_order FOREIGN KEY (order_id)
        REFERENCES sales_order(order_id) ON DELETE CASCADE,
    INDEX idx_history_order_date (order_id,changed_at)
) ENGINE=InnoDB;

INSERT INTO order_status_history (order_id,order_status,changed_at,remarks)
SELECT order_id,order_status,order_date,'Initial imported status'
FROM sales_order;

CREATE TABLE product_inventory (
    product_id INT PRIMARY KEY,
    qty_on_hand INT NOT NULL,
    reorder_point INT NOT NULL,
    reorder_qty INT NOT NULL,
    CONSTRAINT chk_inventory_values CHECK
        (qty_on_hand >= 0 AND reorder_point >= 0 AND reorder_qty > 0),
    CONSTRAINT fk_inventory_product FOREIGN KEY (product_id)
        REFERENCES product(product_id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO product_inventory VALUES
(101,8,3,10),(102,3,4,12),(201,2,3,5),(202,10,2,6);

CREATE TABLE goods_receipt (
    receipt_id INT PRIMARY KEY,
    receipt_date DATE NOT NULL,
    receipt_status ENUM('pending','posted') NOT NULL DEFAULT 'pending'
) ENGINE=InnoDB;

CREATE TABLE goods_receipt_line (
    receipt_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity_received INT NOT NULL,
    PRIMARY KEY (receipt_id,product_id),
    CONSTRAINT chk_receipt_quantity CHECK (quantity_received > 0),
    CONSTRAINT fk_receipt_line_header FOREIGN KEY (receipt_id)
        REFERENCES goods_receipt(receipt_id) ON DELETE CASCADE,
    CONSTRAINT fk_receipt_line_product FOREIGN KEY (product_id)
        REFERENCES product(product_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO goods_receipt VALUES (7001,'2026-11-04','pending');
INSERT INTO goods_receipt_line VALUES (7001,101,5),(7001,201,4);

CREATE TABLE loyalty_award (
    order_id INT PRIMARY KEY,
    customer_id INT NOT NULL,
    points_awarded INT NOT NULL,
    awarded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_award_points CHECK (points_awarded >= 0),
    CONSTRAINT fk_award_order FOREIGN KEY (order_id)
        REFERENCES sales_order(order_id) ON DELETE RESTRICT,
    CONSTRAINT fk_award_customer FOREIGN KEY (customer_id)
        REFERENCES customer(customer_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE supplier_settlement (
    settlement_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    supplier_id INT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    settlement_amount DECIMAL(14,2) NOT NULL,
    generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_supplier_period (supplier_id,period_start,period_end),
    CONSTRAINT chk_settlement_period CHECK (period_end >= period_start),
    CONSTRAINT chk_settlement_amount CHECK (settlement_amount >= 0),
    CONSTRAINT fk_settlement_supplier FOREIGN KEY (supplier_id)
        REFERENCES supplier(supplier_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE reorder_request (
    request_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    request_date DATE NOT NULL,
    requested_qty INT NOT NULL,
    request_status ENUM('open','ordered','closed') NOT NULL DEFAULT 'open',
    UNIQUE KEY uq_product_request_date (product_id,request_date),
    CONSTRAINT chk_reorder_quantity CHECK (requested_qty > 0),
    CONSTRAINT fk_reorder_product FOREIGN KEY (product_id)
        REFERENCES product(product_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE audit_log (
    audit_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    entity_name VARCHAR(40) NOT NULL,
    entity_key VARCHAR(64) NOT NULL,
    event_type VARCHAR(20) NOT NULL,
    old_value VARCHAR(255),
    new_value VARCHAR(255),
    event_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

DELIMITER $$

CREATE PROCEDURE sp_confirm_order(IN p_order_id INT)
BEGIN
    DECLARE v_done BOOLEAN DEFAULT FALSE;
    DECLARE v_product_id INT;
    DECLARE v_quantity INT;
    DECLARE v_count INT DEFAULT 0;
    DECLARE cur_lines CURSOR FOR
        SELECT product_id,quantity
        FROM order_line
        WHERE order_id=p_order_id
        ORDER BY product_id;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done=TRUE;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;
    SELECT COUNT(*) INTO v_count
    FROM sales_order
    WHERE order_id=p_order_id AND order_status='placed';
    IF v_count=0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Order does not exist or is not in placed status';
    END IF;
    SELECT COUNT(*) INTO v_count FROM order_line WHERE order_id=p_order_id;
    IF v_count=0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Order has no line items';
    END IF;

    SET v_done=FALSE;
    OPEN cur_lines;
    order_loop: LOOP
        FETCH cur_lines INTO v_product_id,v_quantity;
        IF v_done THEN LEAVE order_loop; END IF;
        UPDATE product_inventory
        SET qty_on_hand=qty_on_hand-v_quantity
        WHERE product_id=v_product_id AND qty_on_hand>=v_quantity;
        IF ROW_COUNT()<>1 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Insufficient inventory or missing inventory record';
        END IF;
    END LOOP;
    CLOSE cur_lines;

    UPDATE sales_order
    SET order_status='confirmed'
    WHERE order_id=p_order_id AND order_status='placed';
    IF ROW_COUNT()<>1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Order status changed during confirmation';
    END IF;
    COMMIT;
END$$

CREATE PROCEDURE sp_receive_goods(IN p_receipt_id INT)
BEGIN
    DECLARE v_done BOOLEAN DEFAULT FALSE;
    DECLARE v_product_id INT;
    DECLARE v_quantity INT;
    DECLARE v_count INT DEFAULT 0;
    DECLARE cur_receipt CURSOR FOR
        SELECT product_id,quantity_received
        FROM goods_receipt_line
        WHERE receipt_id=p_receipt_id
        ORDER BY product_id;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done=TRUE;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;
    SELECT COUNT(*) INTO v_count
    FROM goods_receipt
    WHERE receipt_id=p_receipt_id AND receipt_status='pending';
    IF v_count=0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Receipt does not exist or has already been posted';
    END IF;
    SELECT COUNT(*) INTO v_count FROM goods_receipt_line WHERE receipt_id=p_receipt_id;
    IF v_count=0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Receipt contains no products';
    END IF;

    SET v_done=FALSE;
    OPEN cur_receipt;
    receipt_loop: LOOP
        FETCH cur_receipt INTO v_product_id,v_quantity;
        IF v_done THEN LEAVE receipt_loop; END IF;
        UPDATE product_inventory
        SET qty_on_hand=qty_on_hand+v_quantity
        WHERE product_id=v_product_id;
        IF ROW_COUNT()<>1 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Inventory record missing for received product';
        END IF;
    END LOOP;
    CLOSE cur_receipt;

    UPDATE goods_receipt SET receipt_status='posted'
    WHERE receipt_id=p_receipt_id AND receipt_status='pending';
    COMMIT;
END$$

CREATE PROCEDURE sp_award_loyalty(IN p_cutoff DATE, OUT p_awarded_points BIGINT)
BEGIN
    DECLARE v_done BOOLEAN DEFAULT FALSE;
    DECLARE v_order_id INT;
    DECLARE v_customer_id INT;
    DECLARE v_total DECIMAL(14,2);
    DECLARE v_points INT;
    DECLARE cur_orders CURSOR FOR
        SELECT s.order_id,s.customer_id,COALESCE(SUM(ol.line_total),0)
        FROM sales_order s
        JOIN order_line ol ON ol.order_id=s.order_id
        WHERE s.order_status='delivered'
          AND DATE(s.order_date)<=p_cutoff
          AND NOT EXISTS (SELECT 1 FROM loyalty_award a WHERE a.order_id=s.order_id)
        GROUP BY s.order_id,s.customer_id
        ORDER BY s.order_id;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done=TRUE;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_cutoff IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Cutoff date is required';
    END IF;
    SET p_awarded_points=0;
    START TRANSACTION;
    SET v_done=FALSE;
    OPEN cur_orders;
    award_loop: LOOP
        FETCH cur_orders INTO v_order_id,v_customer_id,v_total;
        IF v_done THEN LEAVE award_loop; END IF;
        SET v_points=FLOOR(v_total/100);
        INSERT INTO loyalty_award(order_id,customer_id,points_awarded)
        VALUES(v_order_id,v_customer_id,v_points);
        SET p_awarded_points=p_awarded_points+v_points;
    END LOOP;
    CLOSE cur_orders;
    COMMIT;
END$$

CREATE PROCEDURE sp_build_supplier_settlements(
    IN p_period_start DATE,
    IN p_period_end DATE,
    OUT p_total_settled DECIMAL(14,2)
)
BEGIN
    DECLARE v_done BOOLEAN DEFAULT FALSE;
    DECLARE v_supplier_id INT;
    DECLARE v_amount DECIMAL(14,2);
    DECLARE cur_suppliers CURSOR FOR
        SELECT p.supplier_id,ROUND(SUM(ol.line_total),2)
        FROM sales_order s
        JOIN order_line ol ON ol.order_id=s.order_id
        JOIN product p ON p.product_id=ol.product_id
        WHERE s.order_status='delivered'
          AND DATE(s.order_date) BETWEEN p_period_start AND p_period_end
        GROUP BY p.supplier_id
        ORDER BY p.supplier_id;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done=TRUE;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end<p_period_start THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid settlement period';
    END IF;
    SET p_total_settled=0;
    START TRANSACTION;
    SET v_done=FALSE;
    OPEN cur_suppliers;
    settlement_loop: LOOP
        FETCH cur_suppliers INTO v_supplier_id,v_amount;
        IF v_done THEN LEAVE settlement_loop; END IF;
        INSERT INTO supplier_settlement
            (supplier_id,period_start,period_end,settlement_amount)
        VALUES (v_supplier_id,p_period_start,p_period_end,v_amount)
        ON DUPLICATE KEY UPDATE
            settlement_amount=VALUES(settlement_amount),
            generated_at=CURRENT_TIMESTAMP;
        SET p_total_settled=p_total_settled+v_amount;
    END LOOP;
    CLOSE cur_suppliers;
    COMMIT;
END$$

CREATE PROCEDURE sp_queue_reorders(IN p_request_date DATE, OUT p_queued INT)
BEGIN
    DECLARE v_done BOOLEAN DEFAULT FALSE;
    DECLARE v_product_id INT;
    DECLARE v_quantity INT;
    DECLARE cur_low_stock CURSOR FOR
        SELECT product_id,GREATEST(reorder_qty,reorder_point-qty_on_hand)
        FROM product_inventory
        WHERE qty_on_hand<=reorder_point
        ORDER BY product_id;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done=TRUE;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_request_date IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Request date is required';
    END IF;
    SET p_queued=0;
    START TRANSACTION;
    SET v_done=FALSE;
    OPEN cur_low_stock;
    reorder_loop: LOOP
        FETCH cur_low_stock INTO v_product_id,v_quantity;
        IF v_done THEN LEAVE reorder_loop; END IF;
        INSERT INTO reorder_request(product_id,request_date,requested_qty,request_status)
        VALUES(v_product_id,p_request_date,v_quantity,'open')
        ON DUPLICATE KEY UPDATE
            requested_qty=GREATEST(requested_qty,VALUES(requested_qty)),
            request_status='open';
        SET p_queued=p_queued+1;
    END LOOP;
    CLOSE cur_low_stock;
    COMMIT;
END$$

CREATE TRIGGER bi_sales_order
BEFORE INSERT ON sales_order
FOR EACH ROW
BEGIN
    DECLARE v_active INT DEFAULT 0;
    SELECT COUNT(*) INTO v_active
    FROM customer
    WHERE customer_id=NEW.customer_id AND is_active=TRUE;
    IF v_active=0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Orders require an active customer';
    END IF;
END$$

CREATE TRIGGER bi_order_line
BEFORE INSERT ON order_line
FOR EACH ROW
BEGIN
    DECLARE v_valid_order INT DEFAULT 0;
    DECLARE v_active_product INT DEFAULT 0;
    SELECT COUNT(*) INTO v_valid_order
    FROM sales_order
    WHERE order_id=NEW.order_id AND order_status='draft';
    SELECT COUNT(*) INTO v_active_product
    FROM product
    WHERE product_id=NEW.product_id AND is_active=TRUE;
    IF v_valid_order=0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Order lines can only be added to draft orders';
    END IF;
    IF v_active_product=0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Order lines require an active product';
    END IF;
END$$

CREATE TRIGGER bu_sales_order
BEFORE UPDATE ON sales_order
FOR EACH ROW
BEGIN
    IF NEW.order_status<>OLD.order_status AND NOT (
        (OLD.order_status='draft' AND NEW.order_status IN ('placed','cancelled')) OR
        (OLD.order_status='placed' AND NEW.order_status IN ('confirmed','cancelled')) OR
        (OLD.order_status='confirmed' AND NEW.order_status IN ('shipped','cancelled')) OR
        (OLD.order_status='shipped' AND NEW.order_status='delivered')
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Invalid order status transition';
    END IF;
END$$

CREATE TRIGGER au_sales_order
AFTER UPDATE ON sales_order
FOR EACH ROW
BEGIN
    IF NEW.order_status<>OLD.order_status THEN
        INSERT INTO order_status_history(order_id,order_status,remarks)
        VALUES(NEW.order_id,NEW.order_status,'Status changed by database operation');
        INSERT INTO audit_log(entity_name,entity_key,event_type,old_value,new_value)
        VALUES('sales_order',CAST(NEW.order_id AS CHAR),'status',OLD.order_status,NEW.order_status);
    END IF;
END$$

CREATE TRIGGER au_product
AFTER UPDATE ON product
FOR EACH ROW
BEGIN
    IF NEW.list_price<>OLD.list_price THEN
        INSERT INTO audit_log(entity_name,entity_key,event_type,old_value,new_value)
        VALUES('product',CAST(NEW.product_id AS CHAR),'price',CAST(OLD.list_price AS CHAR),CAST(NEW.list_price AS CHAR));
    END IF;
END$$

CREATE FUNCTION fn_discounted_price(
    p_price DECIMAL(12,2),
    p_discount_pct DECIMAL(5,2)
)
RETURNS DECIMAL(12,2)
DETERMINISTIC
NO SQL
BEGIN
    IF p_price IS NULL OR p_discount_pct IS NULL OR p_price<0 OR p_discount_pct<0 OR p_discount_pct>100 THEN
        RETURN NULL;
    END IF;
    RETURN ROUND(p_price*(1-p_discount_pct/100),2);
END$$

CREATE FUNCTION fn_warranty_expiry(
    p_purchase_date DATE,
    p_months INT
)
RETURNS DATE
DETERMINISTIC
NO SQL
BEGIN
    IF p_purchase_date IS NULL OR p_months IS NULL OR p_months<0 OR p_months>120 THEN
        RETURN NULL;
    END IF;
    RETURN DATE_ADD(p_purchase_date,INTERVAL p_months MONTH);
END$$

DELIMITER ;

INSERT INTO sales_order (order_id,customer_id,order_date,order_status)
VALUES (5004,1,'2026-11-04 17:00:00','draft');
INSERT INTO order_line (order_id,product_id,quantity,unit_price)
VALUES (5004,101,1,45000);
UPDATE sales_order SET order_status='placed' WHERE order_id=5004;
UPDATE product SET list_price=list_price+1 WHERE product_id=101;
UPDATE product SET list_price=list_price-1 WHERE product_id=101;

CALL sp_confirm_order(5001);
CALL sp_receive_goods(7001);
CALL sp_award_loyalty('2026-11-04',@awarded_points);
CALL sp_build_supplier_settlements('2026-11-01','2026-11-04',@total_settled);
CALL sp_queue_reorders('2026-11-04',@queued_reorders);

SELECT @awarded_points AS awarded_points,
       @total_settled AS total_supplier_settlements,
       @queued_reorders AS reorder_requests_processed;

SELECT fn_discounted_price(45000,10) AS discounted_price,
       fn_warranty_expiry('2026-11-04',36) AS warranty_expiry;

SELECT s.order_id,ROUND(SUM(l.line_total),2) AS calculated_order_total
FROM sales_order s
JOIN order_line l ON l.order_id=s.order_id
GROUP BY s.order_id
ORDER BY s.order_id;

SELECT c.customer_id,c.customer_name,COALESCE(SUM(a.points_awarded),0) AS loyalty_points
FROM customer c
LEFT JOIN loyalty_award a ON a.customer_id=c.customer_id
GROUP BY c.customer_id,c.customer_name
ORDER BY c.customer_id;

SELECT 'unf_to_nf1_expansion' AS verification,
       COUNT(*) AS violations
FROM unf_sales_order o
CROSS JOIN JSON_TABLE(o.items,'$[*]' COLUMNS (
    product_id INT PATH '$.product_id',
    quantity INT PATH '$.quantity',
    unit_price DECIMAL(12,2) PATH '$.unit_price',
    plan_code VARCHAR(24) PATH '$.plan_code',
    warranty_months INT PATH '$.warranty_months'
)) j
LEFT JOIN nf1_order_line n ON n.order_id=o.order_id AND n.product_id=j.product_id
WHERE n.order_id IS NULL OR n.quantity<>j.quantity OR n.unit_price<>j.unit_price
   OR n.plan_code<>j.plan_code OR n.warranty_months<>j.warranty_months;

SELECT 'nf1_to_nf2_lossless' AS verification,
       COUNT(*) AS violations
FROM nf1_order_line n
LEFT JOIN nf2_order o ON o.order_id=n.order_id
LEFT JOIN nf2_product p ON p.product_id=n.product_id
LEFT JOIN nf2_order_line l ON l.order_id=n.order_id AND l.product_id=n.product_id
WHERE o.order_id IS NULL OR p.product_id IS NULL OR l.order_id IS NULL
   OR n.customer_id<>o.customer_id OR n.customer_name<>o.customer_name
   OR n.customer_email<>o.customer_email OR n.postal_code<>o.postal_code
   OR n.product_name<>p.product_name OR n.supplier_id<>p.supplier_id
   OR n.quantity<>l.quantity OR n.unit_price<>l.unit_price
   OR n.plan_code<>l.plan_code OR n.warranty_months<>l.warranty_months;

SELECT 'nf2_to_3nf_order_lossless' AS verification,
       COUNT(*) AS violations
FROM nf2_order n
LEFT JOIN sales_order o ON o.order_id=n.order_id
LEFT JOIN customer c ON c.customer_id=o.customer_id
LEFT JOIN postal_area a ON a.postal_code=c.postal_code
WHERE o.order_id IS NULL OR c.customer_id IS NULL OR a.postal_code IS NULL
   OR n.order_date<>o.order_date OR n.order_status<>o.order_status
   OR n.customer_id<>o.customer_id OR n.customer_name<>c.customer_name OR n.customer_email<>c.email
   OR n.postal_code<>a.postal_code OR n.city<>a.city OR n.region<>a.region;

SELECT 'nf2_to_3nf_product_lossless' AS verification,
       COUNT(*) AS violations
FROM nf2_product n
LEFT JOIN product p ON p.product_id=n.product_id
LEFT JOIN supplier s ON s.supplier_id=p.supplier_id
WHERE p.product_id IS NULL OR s.supplier_id IS NULL
   OR n.product_name<>p.product_name OR n.supplier_id<>s.supplier_id
   OR n.list_price<>p.list_price OR n.supplier_name<>s.supplier_name OR n.supplier_phone<>s.phone;

SELECT 
    'nf2_order_line_reconstruction' AS verification,
    COUNT(*) AS violations
FROM
    nf2_order_line n
        LEFT JOIN
    order_line l ON l.order_id = n.order_id
        AND l.product_id = n.product_id
        LEFT JOIN
    product p ON p.product_id = l.product_id
        LEFT JOIN
    order_plan op ON op.order_id = l.order_id
        LEFT JOIN
    warranty_plan w ON w.plan_code = op.plan_code
        AND w.supplier_id = p.supplier_id
WHERE
    l.order_id IS NULL
        OR w.plan_code IS NULL
        OR n.quantity <> l.quantity
        OR n.unit_price <> l.unit_price
        OR n.plan_code <> w.plan_code
        OR n.warranty_months <> w.warranty_months;

CREATE TEMPORARY TABLE nf3_order_supplier_plan_check AS
SELECT
    order_id,
    supplier_id,
    plan_code
FROM nf3_order_supplier_plan;

SELECT
    '3nf_to_bcnf_lossless' AS verification,
    COUNT(*) AS violations
FROM nf3_order_supplier_plan n
LEFT JOIN order_plan op
    ON op.order_id = n.order_id
    AND op.plan_code = n.plan_code
LEFT JOIN warranty_plan w
    ON w.plan_code = op.plan_code
    AND w.supplier_id = n.supplier_id
WHERE op.order_id IS NULL
   OR w.plan_code IS NULL
UNION ALL
SELECT
    '3nf_to_bcnf_extra_rows',
    COUNT(*)
FROM order_plan op
JOIN warranty_plan w
    ON w.plan_code = op.plan_code
WHERE NOT EXISTS (
    SELECT 1
    FROM nf3_order_supplier_plan_check n_check
    WHERE n_check.order_id = op.order_id
      AND n_check.supplier_id = w.supplier_id
      AND n_check.plan_code = op.plan_code
);


DROP TEMPORARY TABLE IF EXISTS nf3_supplier_capability;
DROP TEMPORARY TABLE IF EXISTS nf3_supplier_capability_check;

CREATE TEMPORARY TABLE nf3_supplier_capability (
    supplier_id INT NOT NULL,
    certification VARCHAR(50) NOT NULL,
    service_region VARCHAR(80) NOT NULL,
    PRIMARY KEY (
        supplier_id,
        certification,
        service_region
    )
);

INSERT INTO nf3_supplier_capability
SELECT
    supplier_id,
    certification,
    service_region
FROM nf2_supplier_capability;

CREATE TEMPORARY TABLE nf3_supplier_capability_check (
    supplier_id INT NOT NULL,
    certification VARCHAR(50) NOT NULL,
    service_region VARCHAR(80) NOT NULL,
    PRIMARY KEY (
        supplier_id,
        certification,
        service_region
    )
);

INSERT INTO nf3_supplier_capability_check
SELECT
    supplier_id,
    certification,
    service_region
FROM nf3_supplier_capability;
SELECT
    '4nf_lossless_reconstruction' AS verification,

    (
        SELECT COUNT(*)
        FROM nf3_supplier_capability AS original_data
        LEFT JOIN supplier_certification AS c
            ON c.supplier_id = original_data.supplier_id
            AND c.certification = original_data.certification
        LEFT JOIN supplier_service_region AS r
            ON r.supplier_id = original_data.supplier_id
            AND r.service_region = original_data.service_region
        WHERE c.supplier_id IS NULL
           OR r.supplier_id IS NULL
    )
    +
    (
        SELECT COUNT(*)
        FROM supplier_certification AS c
        INNER JOIN supplier_service_region AS r
            ON r.supplier_id = c.supplier_id
        WHERE NOT EXISTS (
            SELECT 1
            FROM nf3_supplier_capability_check AS check_data
            WHERE check_data.supplier_id = c.supplier_id
              AND check_data.certification = c.certification
              AND check_data.service_region = r.service_region
        )
    ) AS violations;
SELECT s.supplier_id,
       (SELECT COUNT(*) FROM supplier_certification c WHERE c.supplier_id=s.supplier_id) AS certification_count,
       (SELECT COUNT(*) FROM supplier_service_region r WHERE r.supplier_id=s.supplier_id) AS region_count,
       (SELECT COUNT(*) FROM nf3_supplier_capability n WHERE n.supplier_id=s.supplier_id) AS combined_rows,
       (SELECT COUNT(*) FROM supplier_certification c WHERE c.supplier_id=s.supplier_id)
       *
       (SELECT COUNT(*) FROM supplier_service_region r WHERE r.supplier_id=s.supplier_id) AS expected_rows
FROM supplier s;

SELECT p.product_name,o.offer_name,o.discount_pct,
       fn_discounted_price(p.list_price,o.discount_pct) AS offer_price
FROM offer o
JOIN product p ON p.product_id=o.product_id
WHERE o.is_active=TRUE AND CURRENT_DATE BETWEEN o.start_date AND o.end_date;

SELECT p.product_name,ROUND(AVG(f.rating),2) AS average_rating,COUNT(*) AS review_count
FROM feedback f
JOIN product p ON p.product_id=f.product_id
GROUP BY p.product_id,p.product_name;

SELECT 'functional_dependency_consistency' AS verification,
       (SELECT COUNT(*) FROM (
            SELECT postal_code FROM unf_customer
            GROUP BY postal_code
            HAVING COUNT(DISTINCT CONCAT_WS('|',city,region))>1
        ) a)
       + (SELECT COUNT(*) FROM (
            SELECT plan_code FROM nf1_order_line
            GROUP BY plan_code
            HAVING COUNT(DISTINCT CONCAT_WS('|',supplier_id,warranty_months))>1
        ) b)
       + (SELECT COUNT(*) FROM unf_product p
          JOIN unf_supplier s ON s.supplier_id=p.supplier_id
          WHERE p.supplier_name<>s.supplier_name OR p.supplier_phone<>s.supplier_phone) AS violations;

SELECT 'foreign_key_integrity' AS verification,
       (SELECT COUNT(*) FROM customer c LEFT JOIN postal_area a ON a.postal_code=c.postal_code WHERE a.postal_code IS NULL)
       + (SELECT COUNT(*) FROM product p LEFT JOIN supplier s ON s.supplier_id=p.supplier_id WHERE s.supplier_id IS NULL)
       + (SELECT COUNT(*) FROM sales_order o LEFT JOIN customer c ON c.customer_id=o.customer_id WHERE c.customer_id IS NULL)
       + (SELECT COUNT(*) FROM order_line l LEFT JOIN sales_order o ON o.order_id=l.order_id WHERE o.order_id IS NULL)
       + (SELECT COUNT(*) FROM order_line l LEFT JOIN product p ON p.product_id=l.product_id WHERE p.product_id IS NULL)
       + (SELECT COUNT(*) FROM order_plan op LEFT JOIN sales_order o ON o.order_id=op.order_id WHERE o.order_id IS NULL)
       + (SELECT COUNT(*) FROM order_plan op LEFT JOIN warranty_plan w ON w.plan_code=op.plan_code WHERE w.plan_code IS NULL) AS violations;

SELECT routine_type,COUNT(*) AS object_count
FROM information_schema.routines
WHERE routine_schema=DATABASE()
  AND routine_name IN (
    'sp_confirm_order','sp_receive_goods','sp_award_loyalty',
    'sp_build_supplier_settlements','sp_queue_reorders',
    'fn_discounted_price','fn_warranty_expiry'
  )
GROUP BY routine_type;

SELECT COUNT(*) AS trigger_count
FROM information_schema.triggers
WHERE trigger_schema=DATABASE()
  AND trigger_name IN ('bi_sales_order','bi_order_line','bu_sales_order','au_sales_order','au_product');

SELECT COUNT(*) AS normalized_customers FROM customer;
SELECT COUNT(*) AS normalized_suppliers FROM supplier;
SELECT COUNT(*) AS normalized_products FROM product;
SELECT COUNT(*) AS normalized_orders FROM sales_order;

START TRANSACTION;
SAVEPOINT before_price_change;
UPDATE product SET list_price=list_price+100 WHERE product_id=102;
ROLLBACK TO SAVEPOINT before_price_change;
RELEASE SAVEPOINT before_price_change;
COMMIT;

BEGIN;
UPDATE product SET list_price=list_price+50 WHERE product_id=102;
ROLLBACK;

START TRANSACTION;
SELECT product_id,qty_on_hand FROM product_inventory
WHERE product_id=101 FOR SHARE;
COMMIT;

START TRANSACTION;
SELECT product_id,qty_on_hand FROM product_inventory
WHERE product_id=101 FOR UPDATE;
SAVEPOINT before_inventory_edit;
UPDATE product_inventory SET qty_on_hand=qty_on_hand-1
WHERE product_id=101 AND qty_on_hand>=1;
ROLLBACK TO SAVEPOINT before_inventory_edit;
RELEASE SAVEPOINT before_inventory_edit;
COMMIT;

SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
START TRANSACTION;
SELECT product_id,qty_on_hand FROM product_inventory
WHERE product_id BETWEEN 101 AND 201 FOR UPDATE;
COMMIT;

LOCK TABLES product_inventory READ;
SELECT * FROM product_inventory ORDER BY product_id;
UNLOCK TABLES;

LOCK TABLES product_inventory WRITE;
SELECT COUNT(*) AS inventory_rows FROM product_inventory;
UNLOCK TABLES;

START TRANSACTION READ ONLY;
SELECT product_id,qty_on_hand FROM product_inventory ORDER BY product_id;
COMMIT;

SELECT product_id,qty_on_hand FROM product_inventory ORDER BY product_id;

