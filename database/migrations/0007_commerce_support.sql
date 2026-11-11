-- targets: app
-- Commerce support.
--
-- Source finding F18: sales_order, offer, feedback and goods_receipt have plain INT primary
-- keys with no AUTO_INCREMENT, so the original schema has no way to issue new ids. Rather than
-- altering original tables, the application allocates ids from this lock-protected sequence
-- (SELECT ... FOR UPDATE inside the caller's transaction). Allocation is gap-tolerant and
-- never reuses an id.

CREATE TABLE id_sequence (
    seq_name VARCHAR(40) PRIMARY KEY,
    next_id  INT NOT NULL,
    CONSTRAINT chk_seq_positive CHECK (next_id > 0)
) ENGINE=InnoDB;

-- Start well clear of the original sample ids (5001-5004, 7001, offers 1-3, feedback 1-3).
INSERT INTO id_sequence (seq_name, next_id)
SELECT 'sales_order', GREATEST(6001, COALESCE(MAX(order_id), 0) + 1) FROM sales_order
UNION ALL SELECT 'offer', GREATEST(100, COALESCE(MAX(offer_id), 0) + 1) FROM offer
UNION ALL SELECT 'feedback', GREATEST(100, COALESCE(MAX(feedback_id), 0) + 1) FROM feedback
UNION ALL SELECT 'goods_receipt', GREATEST(7101, COALESCE(MAX(receipt_id), 0) + 1) FROM goods_receipt;

-- Order cancellations are recorded with their reason and whether stock was returned.
-- (The original schema allows confirmed -> cancelled but never restores the stock that
-- sp_confirm_order deducted; the application's cancellation service does, and records it here.)
CREATE TABLE order_cancellation (
    order_id      INT PRIMARY KEY,
    cancelled_by  INT NULL,
    previous_status ENUM('draft','placed','confirmed') NOT NULL,
    reason        VARCHAR(255) NOT NULL,
    stock_restored BOOLEAN NOT NULL,
    cancelled_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cancel_order FOREIGN KEY (order_id) REFERENCES sales_order(order_id) ON DELETE CASCADE,
    CONSTRAINT fk_cancel_user FOREIGN KEY (cancelled_by) REFERENCES app_user(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;
