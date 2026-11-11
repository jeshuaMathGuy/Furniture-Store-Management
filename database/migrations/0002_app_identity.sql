-- targets: app
-- FURNI / FORM extension: identity, sessions, RBAC, provenance.
-- Additive only: no original table, key, trigger or routine is altered.

CREATE TABLE data_provenance (
    entity_name VARCHAR(64) NOT NULL,
    entity_key  VARCHAR(64) NOT NULL,
    source      ENUM('original_sql','demo_seed') NOT NULL,
    note        VARCHAR(255),
    PRIMARY KEY (entity_name, entity_key),
    INDEX idx_provenance_source (source)
) ENGINE=InnoDB;

CREATE TABLE app_role (
    role_code   VARCHAR(20) PRIMARY KEY,
    role_name   VARCHAR(60) NOT NULL,
    description VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE app_user (
    user_id       INT AUTO_INCREMENT PRIMARY KEY,
    email         VARCHAR(160) NOT NULL UNIQUE,
    display_name  VARCHAR(120) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    is_demo       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE app_user_role (
    user_id   INT NOT NULL,
    role_code VARCHAR(20) NOT NULL,
    PRIMARY KEY (user_id, role_code),
    CONSTRAINT fk_user_role_user FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE,
    CONSTRAINT fk_user_role_role FOREIGN KEY (role_code) REFERENCES app_role(role_code) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Only a SHA-256 digest of the session token is stored.
CREATE TABLE app_session (
    session_hash CHAR(64) PRIMARY KEY,
    user_id      INT NOT NULL,
    csrf_token   CHAR(43) NOT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at   DATETIME NOT NULL,
    revoked_at   DATETIME NULL,
    CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE,
    INDEX idx_session_user (user_id),
    INDEX idx_session_expiry (expires_at)
) ENGINE=InnoDB;

-- A login maps to at most one customer, and a customer to at most one login.
CREATE TABLE customer_user_mapping (
    user_id     INT PRIMARY KEY,
    customer_id INT NOT NULL UNIQUE,
    CONSTRAINT fk_cum_user FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE,
    CONSTRAINT fk_cum_customer FOREIGN KEY (customer_id) REFERENCES customer(customer_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE supplier_user_mapping (
    user_id     INT PRIMARY KEY,
    supplier_id INT NOT NULL,
    CONSTRAINT fk_sum_user FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE,
    CONSTRAINT fk_sum_supplier FOREIGN KEY (supplier_id) REFERENCES supplier(supplier_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    INDEX idx_sum_supplier (supplier_id)
) ENGINE=InnoDB;
