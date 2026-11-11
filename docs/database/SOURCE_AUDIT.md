# Source SQL audit: `furniture_store_normalized.sql`

| Item | Value |
|---|---|
| Preserved copy | `database/original/furniture_store_normalized.sql` (byte-identical, never edited) |
| SHA-256 | `1442aea4e8b0e01eb8861677761f2f0ae9f074f5da020a18f08d89964f7640ce` |
| Lines | 1,155 |
| Target engine | MySQL 8.x (`JSON_TABLE`, CHECK constraints, `FOR SHARE`, generated columns). Verified on **MySQL 8.4 LTS**; see "Execution verification" |

The migration runner checks this hash before it executes the file. If the file changes, setup stops.

## 1. Verified object inventory

### 1.1 Permanent tables (20)

| # | Table | PK | Unique | FKs (→ target, ON UPDATE / ON DELETE) | CHECKs | Other |
|---|---|---|---|---|---|---|
| 1 | `customer` | customer_id | email | postal_code → postal_area (CASCADE/RESTRICT) *added by ALTER* | – | |
| 2 | `supplier` | supplier_id | supplier_name | – | – | |
| 3 | `product` | product_id | – | supplier_id → supplier (CASCADE/RESTRICT) | chk_product_price | idx_product_supplier |
| 4 | `sales_order` | order_id | – | customer_id → customer (CASCADE/RESTRICT) | – | ENUM status; idx (customer_id,order_date), (order_status,order_date) |
| 5 | `postal_area` | postal_code | – | – | – | |
| 6 | `order_line` | (order_id, product_id) | – | order_id → sales_order (CASCADE/CASCADE); product_id → product (CASCADE/RESTRICT) | chk_line_quantity, chk_line_price, chk_line_discount | **STORED generated** `line_total`; idx_line_product |
| 7 | `warranty_plan` | plan_code | – | supplier_id → supplier (CASCADE/RESTRICT) | chk_warranty_months | |
| 8 | `order_plan` | (order_id, plan_code) | – | order_id → sales_order (CASCADE/CASCADE); plan_code → warranty_plan (CASCADE/RESTRICT) | – | |
| 9 | `supplier_certification` | (supplier_id, certification) | – | supplier_id → supplier (CASCADE/CASCADE) | – | |
| 10 | `supplier_service_region` | (supplier_id, service_region) | – | supplier_id → supplier (CASCADE/CASCADE) | – | |
| 11 | `offer` | offer_id | – | product_id → product (default/CASCADE) | chk_offer_discount, chk_offer_dates | idx_offer_dates |
| 12 | `feedback` | feedback_id | (customer_id, product_id) | customer_id → customer (–/CASCADE); product_id → product (–/CASCADE) | chk_feedback_rating | |
| 13 | `order_status_history` | history_id (AUTO_INCREMENT) | – | order_id → sales_order (–/CASCADE) | – | idx (order_id, changed_at) |
| 14 | `product_inventory` | product_id | – | product_id → product (CASCADE/RESTRICT) | chk_inventory_values | |
| 15 | `goods_receipt` | receipt_id | – | – | – | ENUM pending/posted |
| 16 | `goods_receipt_line` | (receipt_id, product_id) | – | receipt_id → goods_receipt (–/CASCADE); product_id → product (–/RESTRICT) | chk_receipt_quantity | |
| 17 | `loyalty_award` | order_id | – | order_id → sales_order (–/RESTRICT); customer_id → customer (–/RESTRICT) | chk_award_points | |
| 18 | `supplier_settlement` | settlement_id (AUTO_INCREMENT) | (supplier_id, period_start, period_end) | supplier_id → supplier (–/RESTRICT) | chk_settlement_period, chk_settlement_amount | |
| 19 | `reorder_request` | request_id (AUTO_INCREMENT) | (product_id, request_date) | product_id → product (–/RESTRICT) | chk_reorder_quantity | ENUM open/ordered/closed |
| 20 | `audit_log` | audit_id (AUTO_INCREMENT) | – | – | – | |

**Totals: 20 tables, 21 foreign keys, 14 named CHECK constraints, 1 generated column, 0 views.**

### 1.2 Temporary (session-scoped) teaching relations (14)

`unf_customer`, `unf_supplier`, `unf_product`, `unf_sales_order`, `nf1_order_line`, `nf1_supplier_capability`, `nf2_order`, `nf2_product`, `nf2_order_line`, `nf2_supplier_capability`, `nf3_order_supplier_plan`, `nf3_supplier_capability` (created twice), `nf3_order_supplier_plan_check`, `nf3_supplier_capability_check`.

These tables exist only while the session that ran the script is open. The runner copies them into the persistent schema `furniture_teaching` before it closes that session (see §4).

### 1.3 Stored programs

| Kind | Name | Writes | Transaction behaviour |
|---|---|---|---|
| Procedure | `sp_confirm_order(order_id)` | product_inventory, sales_order (→ triggers) | Own `START TRANSACTION`, EXIT handler `ROLLBACK; RESIGNAL` |
| Procedure | `sp_receive_goods(receipt_id)` | product_inventory, goods_receipt | same |
| Procedure | `sp_award_loyalty(cutoff, OUT points)` | loyalty_award | same; points = `FLOOR(total/100)` |
| Procedure | `sp_build_supplier_settlements(start, end, OUT total)` | supplier_settlement (upsert) | same |
| Procedure | `sp_queue_reorders(date, OUT queued)` | reorder_request (upsert) | same; qty = `GREATEST(reorder_qty, reorder_point - qty_on_hand)` |
| Function | `fn_discounted_price(price, pct)` | – | DETERMINISTIC NO SQL; NULL on invalid input |
| Function | `fn_warranty_expiry(date, months)` | – | DETERMINISTIC NO SQL; NULL outside 0..120 |
| Trigger | `bi_sales_order` BEFORE INSERT sales_order | – | rejects inactive or missing customer |
| Trigger | `bi_order_line` BEFORE INSERT order_line | – | line only for **draft** order and **active** product |
| Trigger | `bu_sales_order` BEFORE UPDATE sales_order | – | state machine (§3.1) |
| Trigger | `au_sales_order` AFTER UPDATE sales_order | order_status_history, audit_log | on status change only |
| Trigger | `au_product` AFTER UPDATE product | audit_log | on list_price change only |

### 1.4 Dependency graph (FK edges)

```
postal_area ◄── customer ◄── sales_order ◄── order_line ──► product ──► supplier
                   ▲             ▲  ▲  ▲                      ▲  ▲  ▲      ▲ ▲ ▲ ▲
                   │             │  │  └ order_plan ─► warranty_plan ──────┘ │ │ │
                   ├ feedback ───┼──┼──────────────────────┘  │  │         │ │ │
                   └ loyalty_award ─┘  order_status_history   │  │         │ │ │
                                                              │  │         │ │ │
          offer ──────────────────────────────────────────────┘  │         │ │ │
          product_inventory ─────────────────────────────────────┤         │ │ │
          goods_receipt ◄── goods_receipt_line ──────────────────┤         │ │ │
          reorder_request ───────────────────────────────────────┘         │ │ │
          supplier_certification ──────────────────────────────────────────┘ │ │
          supplier_service_region ───────────────────────────────────────────┘ │
          supplier_settlement ─────────────────────────────────────────────────┘
audit_log: no FKs (written by the au_sales_order and au_product triggers)
```

Topological load order: postal_area, supplier → customer, product, warranty_plan, goods_receipt → sales_order, offer, product_inventory, supplier_* → order_line, order_plan, feedback, goods_receipt_line, history, loyalty_award, reorder_request, settlement.

## 2. Script phases

| Lines | Phase |
|---|---|
| 1–3 | **Destructive:** `DROP DATABASE IF EXISTS furniture_store_db`, then `CREATE DATABASE` |
| 4–128 | Final tables `customer`, `supplier`, `product`, `sales_order`; UNF temp tables and their data |
| 130–244 | 1NF (`JSON_TABLE` unnesting) and 2NF decomposition |
| 246–371 | 3NF (`postal_area`, permanent loads, `order_line`, `warranty_plan`), BCNF (`order_plan`) and 4NF (`supplier_certification`, `supplier_service_region`) |
| 373–509 | Operational tables and seed rows (`offer`, `feedback`, history, inventory, receipts, …) |
| 511–839 | 5 procedures, 5 triggers, 2 functions (`DELIMITER $$`) |
| 841–853 | **Operational demo:** order 5004 draft→placed, price ±1, all 5 procedures called |
| 855–1108 | Verification and report SELECTs |
| 1110–1154 | Transaction, savepoint, locking-read and `LOCK TABLES` demos (all rolled back or read-only) |

## 3. Findings: inconsistencies, limitations, risks

Severity: **H** = affects correctness or concurrency; **M** = affects the teaching result or data quality; **L** = cosmetic or a documented assumption.

| # | Sev | Finding | Consequence and handling |
|---|---|---|---|
| F1 | **H** | `sp_receive_goods` checks `receipt_status='pending'` with a plain (non-locking) `SELECT COUNT(*)`, and never checks `ROW_COUNT()` on its final `UPDATE goods_receipt`. | Two concurrent calls for the same receipt can both pass the check. Both then add stock, and the second blocks on the inventory row lock until the first commits. The second `UPDATE goods_receipt` matches 0 rows and commits silently, so stock is **double-posted**. A characterization test reproduces this deterministically (`database/tests/concurrency.test.ts`). The original procedure is not changed. Instead the application service wraps the call in `GET_LOCK('furni:receipt:<id>')`, and a test also covers that mitigation. |
| F2 | **M** | The script's own check `nf2_to_3nf_order_lossless` runs **after** `CALL sp_confirm_order(5001)`. It compares `nf2_order.order_status` (`placed`) with the live `sales_order` (`confirmed`). | That check reports **1 violation** even though the decomposition is lossless. The cause is the order of operations, not the design. The teaching snapshot is captured *before* the operational demo, so it reports 0 violations, and the lab explains the difference. |
| F3 | **M** | Every procedure runs its own `START TRANSACTION`, which **implicitly commits** any outer transaction. | A caller cannot wrap a procedure call in a transaction and roll it back. Sandbox reset is therefore done by rebuilding the database, not with `ROLLBACK`. Execution traces take before and after snapshots outside the procedure. |
| F4 | **M** | `bi_order_line` allows lines only on **draft** orders, yet the seeded orders are placed or delivered. Their lines load only because the triggers are created after the data. | Seeds cannot be replayed after the triggers exist. New orders must be created as draft, then lines added, then the order placed. The checkout service follows that order. |
| F5 | **M** | `postal_area` is filled only from `nf2_order` (postal codes that appear in orders), not from `unf_customer`. | A customer with no orders and a new postal code would break `fk_customer_postal`. It works with this sample only. The app migration adds postal-area rows before it creates new customers. |
| F6 | **M** | Temporary tables cannot be referenced twice in one statement in MySQL (`ER_CANT_REOPEN_TABLE`). The `_check` copies exist for this reason. | Teaching snapshots are persistent tables, so this limitation does not affect the lab. |
| F7 | **M** | The offers report uses `CURRENT_DATE`. Rows created by triggers and procedures use `CURRENT_TIMESTAMP` (`changed_at`, `event_time`, `awarded_at`, `generated_at`). | Results change with the wall-clock time. Determinism tests leave out those columns, and the lab passes an explicit "as-of" date. |
| F8 | **L** | `customer` is loaded with `is_active=TRUE` regardless of `unf_customer.is_active`. | All sample values are TRUE, so there is no data difference. Documented. |
| F9 | **L** | `order_line.discount_pct` is always 0. `unit_price` is below `list_price`, but `offer` has no link to `order_line`. | The negotiated price is stored but its source is not modelled. Checkout will set `discount_pct` from an active offer and record the source in an extension table. |
| F10 | **L** | `loyalty_award.customer_id` duplicates `sales_order.customer_id`, and no constraint keeps the two equal. | Redundancy *across* tables; the table itself is still in BCNF. The integrity inspector runs a consistency query for it. |
| F11 | **L** | Order 5004 has no "initial" history row: the history import (line 424) runs before 5004 is inserted. Orders 5002 and 5003 are recorded as `delivered` without intermediate history. | Imported history is incomplete by design. The lab labels it "imported". |
| F12 | **L** | Triggers only guard INSERT on `order_line`. Lines of non-draft orders can still be **updated** or deleted. | Documented. The application never updates lines after an order is placed. |
| F13 | **L** | `sp_queue_reorders` returns the number of products **processed**, not rows inserted (an upsert may update an existing row). | The lab shows both numbers. |
| F14 | **L** | `VALUES()` inside `ON DUPLICATE KEY UPDATE` is deprecated since MySQL 8.0.20. It still works in 8.4. | **Verified on 8.4.13:** a direct statement raises warning 1287. When the same statement runs inside `sp_build_supplier_settlements` or `sp_queue_reorders`, the warning is **not** returned to the `CALL` caller. Kept as written. The SQL lab will show this using a direct statement. |
| F15 | **L** | Settlements are grouped by `order_date`, not delivery date, and a re-run overwrites `settlement_amount`. | The source formula is kept. Any other business rule will be labelled as an enhancement. |
| F16 | **L** | BCNF step: the dependency `(order_id, supplier_id) → plan_code` is **not preserved** by the decomposition into `warranty_plan(plan_code, supplier_id)` + `order_plan(order_id, plan_code)`. | This is the expected BCNF trade-off. The lab states it explicitly. |
| F17 | **L** | `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` (line 1136) applies only to the *next* transaction. | Explained in the transaction lab. |
| F18 | **M** | `sales_order`, `offer`, `feedback` and `goods_receipt` have plain `INT` primary keys without `AUTO_INCREMENT`, so the schema cannot issue new ids. | The application allocates ids from a lock-protected `id_sequence` table (migration 0007), never below `MAX(id)+1`. Original tables are unchanged. |
| F19 | **M** | `confirmed → cancelled` is allowed by `bu_sales_order`, but nothing returns the stock `sp_confirm_order` deducted. | The cancellation service restores it in the same transaction and records it in `order_cancellation` (an enhancement, labelled as such). |

### 3.1 Order state machine (`bu_sales_order`)

```
draft ──► placed ──► confirmed ──► shipped ──► delivered
  │          │            │
  └─► cancelled ◄─────────┘   (shipped and delivered cannot be cancelled)
```

Updates that do not change the status are always allowed.

## 4. Migration strategy

1. **Baseline (0001):** the runner executes the original file *unchanged* as root, statement by statement, with a `DELIMITER`-aware splitter. Every result set is recorded in `database/snapshots/baseline-report.json`.
2. **Teaching capture:** inside the same session, the runner copies tables into `furniture_teaching`:
   * the normalized permanent tables, captured **just before** the operational demo (line 841);
   * all 14 temporary relations, captured at the end of the script.
3. **Lab database:** the same file is replayed into `furniture_lab_db`. The database name is replaced in memory only; the file on disk is untouched. Extension migrations are applied on top. A reset drops the database and rebuilds it (~1–2 s).
4. **Extensions (0002+):** additive only. New tables and views reference the original tables. **No original column, key, constraint, trigger or routine is altered or dropped.** A test compares the original objects' `information_schema` metadata before and after migration.
5. **Re-run guard:** the baseline drops its database, so `db:setup` refuses to run it against a populated application database unless `--reset` is passed.

## 5. Execution verification

Observed on **MySQL 8.4.13** (`mysql:8.4` image) with `pnpm db:setup`, recorded in `database/snapshots/baseline-report.json` (149 statements, 0 errors), and asserted by `database/tests/baseline.test.ts`:

| Check | Expected (derived by hand) | Observed |
|---|---|---|
| `@awarded_points` | 650 (5002) + 370 (5003) = **1020** | ✔ matches |
| `@total_settled` | supplier 20 only: 65000 + 37000 = **102000.00** | ✔ matches |
| `@queued_reorders` | product 102 only (1 ≤ 4) = **1** | ✔ matches |
| `fn_discounted_price(45000,10)` | **40500.00** | ✔ matches |
| `fn_warranty_expiry('2026-11-04',36)` | **2029-11-04** | ✔ matches |
| Final inventory 101/102/201/202 | 12 / 1 / 6 / 10 | ✔ matches |
| `nf2_to_3nf_order_lossless` (script order) | **1** (F2) | ✔ matches |
| All other verification queries | 0 | ✔ matches |
