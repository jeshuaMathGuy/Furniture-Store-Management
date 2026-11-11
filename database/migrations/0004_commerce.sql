-- targets: app
-- Commerce extensions. sales_order and order_line remain the system of record for orders.

CREATE TABLE cart (
    cart_id    INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NOT NULL UNIQUE,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_cart_user FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- PK (cart_id, product_id) mirrors order_line's (order_id, product_id): one variant per product per order.
CREATE TABLE cart_item (
    cart_id    INT NOT NULL,
    product_id INT NOT NULL,
    variant_id INT NULL,
    quantity   INT NOT NULL,
    PRIMARY KEY (cart_id, product_id),
    CONSTRAINT chk_cart_qty CHECK (quantity BETWEEN 1 AND 20),
    CONSTRAINT fk_cart_item_cart FOREIGN KEY (cart_id) REFERENCES cart(cart_id) ON DELETE CASCADE,
    CONSTRAINT fk_cart_item_product FOREIGN KEY (product_id) REFERENCES product(product_id) ON DELETE CASCADE,
    CONSTRAINT fk_cart_item_variant FOREIGN KEY (variant_id, product_id)
        REFERENCES product_variant(variant_id, product_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE shipping_address (
    address_id  INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    line1       VARCHAR(160) NOT NULL,
    line2       VARCHAR(160) NULL,
    postal_code VARCHAR(12) NOT NULL,
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT fk_address_customer FOREIGN KEY (customer_id) REFERENCES customer(customer_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_address_postal FOREIGN KEY (postal_code) REFERENCES postal_area(postal_code)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Variant choice and configuration snapshot for an original order_line row.
CREATE TABLE order_line_configuration (
    order_id      INT NOT NULL,
    product_id    INT NOT NULL,
    variant_id    INT NULL,
    configuration JSON NOT NULL,
    offer_id      INT NULL COMMENT 'Offer that set order_line.discount_pct, if any',
    PRIMARY KEY (order_id, product_id),
    CONSTRAINT fk_olc_line FOREIGN KEY (order_id, product_id) REFERENCES order_line(order_id, product_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_olc_variant FOREIGN KEY (variant_id, product_id)
        REFERENCES product_variant(variant_id, product_id) ON DELETE RESTRICT,
    CONSTRAINT fk_olc_offer FOREIGN KEY (offer_id) REFERENCES offer(offer_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Simulated payments. There are deliberately no columns that could hold card data.
CREATE TABLE payment_record (
    payment_id      INT AUTO_INCREMENT PRIMARY KEY,
    order_id        INT NOT NULL,
    provider        ENUM('simulated','stripe_test') NOT NULL DEFAULT 'simulated',
    provider_ref    VARCHAR(64) NOT NULL,
    amount          DECIMAL(14,2) NOT NULL,
    payment_status  ENUM('authorized','captured','failed','refunded') NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_payment_ref (provider, provider_ref),
    CONSTRAINT chk_payment_amount CHECK (amount >= 0),
    CONSTRAINT fk_payment_order FOREIGN KEY (order_id) REFERENCES sales_order(order_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    INDEX idx_payment_order (order_id)
) ENGINE=InnoDB;

CREATE TABLE shipment (
    shipment_id  INT AUTO_INCREMENT PRIMARY KEY,
    order_id     INT NOT NULL,
    address_id   INT NOT NULL,
    carrier      VARCHAR(60) NOT NULL,
    tracking_ref VARCHAR(64) NULL,
    shipped_at   DATETIME NULL,
    delivered_at DATETIME NULL,
    CONSTRAINT chk_shipment_dates CHECK (delivered_at IS NULL OR (shipped_at IS NOT NULL AND delivered_at >= shipped_at)),
    CONSTRAINT fk_shipment_order FOREIGN KEY (order_id) REFERENCES sales_order(order_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_shipment_address FOREIGN KEY (address_id) REFERENCES shipping_address(address_id)
        ON DELETE RESTRICT,
    INDEX idx_shipment_order (order_id)
) ENGINE=InnoDB;
