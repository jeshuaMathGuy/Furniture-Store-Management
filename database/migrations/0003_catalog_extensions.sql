-- targets: app
-- Catalog extensions. `product` stays authoritative for id, name, supplier and list price.

CREATE TABLE product_category (
    category_code VARCHAR(20) PRIMARY KEY,
    category_name VARCHAR(60) NOT NULL UNIQUE,
    sort_order    TINYINT NOT NULL DEFAULT 0
) ENGINE=InnoDB;

-- 1:1 descriptive extension of product.
CREATE TABLE product_detail (
    product_id     INT PRIMARY KEY,
    category_code  VARCHAR(20) NOT NULL,
    room           ENUM('living','dining','bedroom','office','studio') NOT NULL,
    primary_material VARCHAR(60) NOT NULL,
    style          VARCHAR(40) NOT NULL,
    description    VARCHAR(1000) NOT NULL,
    width_cm       SMALLINT NOT NULL,
    depth_cm       SMALLINT NOT NULL,
    height_cm      SMALLINT NOT NULL,
    model_key      VARCHAR(60) NULL COMMENT 'Procedural/GLB model identifier used by FurnitureViewer',
    CONSTRAINT chk_detail_dims CHECK (width_cm > 0 AND depth_cm > 0 AND height_cm > 0),
    CONSTRAINT fk_detail_product FOREIGN KEY (product_id) REFERENCES product(product_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_detail_category FOREIGN KEY (category_code) REFERENCES product_category(category_code)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    INDEX idx_detail_category (category_code),
    INDEX idx_detail_room (room)
) ENGINE=InnoDB;

CREATE TABLE product_media (
    media_id    INT AUTO_INCREMENT PRIMARY KEY,
    product_id  INT NOT NULL,
    media_type  ENUM('image','model_glb') NOT NULL,
    url         VARCHAR(255) NOT NULL,
    alt_text    VARCHAR(255) NOT NULL,
    sort_order  TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_media_product_url (product_id, url),
    CONSTRAINT fk_media_product FOREIGN KEY (product_id) REFERENCES product(product_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE product_variant (
    variant_id     INT PRIMARY KEY,
    product_id     INT NOT NULL,
    variant_name   VARCHAR(80) NOT NULL,
    material       VARCHAR(60) NOT NULL,
    color_hex      CHAR(7) NOT NULL,
    price_delta    DECIMAL(12,2) NOT NULL DEFAULT 0,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE KEY uq_variant_name (product_id, variant_name),
    -- lets order_line_configuration prove variant/product consistency through a composite FK
    UNIQUE KEY uq_variant_product (variant_id, product_id),
    CONSTRAINT chk_variant_color CHECK (color_hex REGEXP '^#[0-9A-Fa-f]{6}$'),
    CONSTRAINT fk_variant_product FOREIGN KEY (product_id) REFERENCES product(product_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE product_variant_inventory (
    variant_id  INT PRIMARY KEY,
    qty_on_hand INT NOT NULL,
    CONSTRAINT chk_variant_qty CHECK (qty_on_hand >= 0),
    CONSTRAINT fk_variant_inventory FOREIGN KEY (variant_id) REFERENCES product_variant(variant_id)
        ON DELETE CASCADE
) ENGINE=InnoDB;
