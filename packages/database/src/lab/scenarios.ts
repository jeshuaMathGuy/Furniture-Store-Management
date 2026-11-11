import type { ScenarioContext, ScenarioDef, SetupContext } from "./scenario-runner.js";

/**
 * Server-defined lab scenarios. Each run starts from a fresh fixture copy of
 * the sandbox (see fixture.ts), so results are reproducible. Fixture state =
 * the end of the original script: order 5001 confirmed, 5002/5003 delivered,
 * 5004 placed (1 x product 101), receipt 7001 posted, inventory
 * 101/102/201/202 = 12/1/6/10, loyalty for 5002/5003, one settlement.
 */

const ORDER_DATE = "2026-11-10 10:00:00";

/** draft -> lines (bi_order_line) -> placed (bu/au_sales_order). Runs in setup, before the 'before' snapshot. */
async function placedOrder(s: SetupContext, orderId: number, customerId: number, lines: [number, number, number][]) {
  await s.exec("INSERT INTO sales_order (order_id, customer_id, order_date, order_status) VALUES (?, ?, ?, 'draft')", [orderId, customerId, ORDER_DATE]);
  for (const [p, q, price] of lines)
    await s.exec("INSERT INTO order_line (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)", [orderId, p, q, price]);
  await s.exec("UPDATE sales_order SET order_status='placed' WHERE order_id=?", [orderId]);
}

async function readOut(ctx: ScenarioContext, variable: string, key: string) {
  const r = await ctx.exec(`SELECT ${variable} AS v`);
  ctx.output(key, r.rows[0]?.v ?? null);
}

const ORDER_TABLES = ["sales_order", "order_line", "order_status_history", "audit_log"];

// ------------------------------------------------------------------ procedures

const procedures: ScenarioDef[] = [
  {
    id: "proc.confirm_order", category: "procedure", title: "sp_confirm_order: confirm placed order 5004",
    description: "Checks the order is placed and has lines, deducts stock line by line (only if enough is on hand), then sets the status to confirmed. The status change fires au_sales_order, which writes history and audit rows.",
    expected: "committed", mutating: true, watch: [...ORDER_TABLES, "product_inventory"], objects: ["sp_confirm_order", "bu_sales_order", "au_sales_order"],
    async run(ctx) {
      await ctx.exec("CALL sp_confirm_order(?)", [5004], { checkpoint: "After CALL (procedure committed)" });
    },
  },
  {
    id: "proc.confirm_invalid_order", category: "procedure", title: "sp_confirm_order: order that does not exist",
    description: "Order 9999 does not exist, so the first status check signals SQLSTATE 45000 and the EXIT handler rolls back.",
    expected: "failed", expectNoChanges: true, mutating: true, watch: [...ORDER_TABLES, "product_inventory"], objects: ["sp_confirm_order"],
    async run(ctx) { await ctx.exec("CALL sp_confirm_order(?)", [9999]); },
  },
  {
    id: "proc.confirm_wrong_status", category: "procedure", title: "sp_confirm_order: order in the wrong status",
    description: "Order 5002 is already delivered. The procedure only confirms orders in placed status.",
    expected: "failed", expectNoChanges: true, mutating: true, watch: [...ORDER_TABLES, "product_inventory"], objects: ["sp_confirm_order"],
    async run(ctx) { await ctx.exec("CALL sp_confirm_order(?)", [5002]); },
  },
  {
    id: "proc.confirm_empty_order", category: "procedure", title: "sp_confirm_order: placed order with no lines",
    description: "Setup creates order 9101 as draft and places it without adding lines. The line-count check signals 'Order has no line items'.",
    expected: "failed", expectNoChanges: true, mutating: true, watch: [...ORDER_TABLES, "product_inventory"], objects: ["sp_confirm_order"],
    async setup(s) { await placedOrder(s, 9101, 2, []); },
    async run(ctx) { await ctx.exec("CALL sp_confirm_order(?)", [9101]); },
  },
  {
    id: "proc.confirm_insufficient_stock", category: "procedure", title: "sp_confirm_order: insufficient stock (rollback of a partial deduction)",
    description: "Order 9102 has 1 x product 101 (12 on hand) and 5 x product 102 (1 on hand). The cursor deducts 101 first, then the 102 update matches no row, so the procedure signals and its EXIT handler rolls back the 101 deduction too.",
    expected: "failed", expectNoChanges: true, mutating: true, watch: [...ORDER_TABLES, "product_inventory"], objects: ["sp_confirm_order"],
    async setup(s) { await placedOrder(s, 9102, 1, [[101, 1, 45000], [102, 5, 12000]]); },
    async run(ctx) {
      ctx.note("The deduction of product 101 happens inside the procedure's own transaction and is rolled back by its EXIT handler. It cannot be observed from outside (source finding F3); the trace confirms that nothing persisted.");
      await ctx.exec("CALL sp_confirm_order(?)", [9102]);
    },
  },
  {
    id: "proc.confirm_missing_inventory", category: "procedure", title: "sp_confirm_order: product without an inventory record",
    description: "Setup adds product 9301 with no product_inventory row and a placed order for it. The stock UPDATE matches 0 rows and the procedure signals.",
    expected: "failed", expectNoChanges: true, mutating: true, watch: [...ORDER_TABLES, "product_inventory", "product"], objects: ["sp_confirm_order"],
    async setup(s) {
      await s.exec("INSERT INTO product (product_id, product_name, supplier_id, list_price, is_active) VALUES (9301, 'Lab Stool (no inventory row)', 10, 5000, TRUE)");
      await placedOrder(s, 9103, 3, [[9301, 1, 5000]]);
    },
    async run(ctx) { await ctx.exec("CALL sp_confirm_order(?)", [9103]); },
  },
  {
    id: "proc.receive_goods", category: "procedure", title: "sp_receive_goods: post pending receipt 7201",
    description: "Setup creates pending receipt 7201 (3 x 101, 2 x 202). The procedure adds each quantity to stock and marks the receipt posted.",
    expected: "committed", mutating: true, watch: ["goods_receipt", "goods_receipt_line", "product_inventory"], objects: ["sp_receive_goods"],
    async setup(s) {
      await s.exec("INSERT INTO goods_receipt (receipt_id, receipt_date, receipt_status) VALUES (7201, '2026-11-10', 'pending')");
      await s.exec("INSERT INTO goods_receipt_line (receipt_id, product_id, quantity_received) VALUES (7201, 101, 3), (7201, 202, 2)");
    },
    async run(ctx) { await ctx.exec("CALL sp_receive_goods(?)", [7201], { checkpoint: "After CALL (procedure committed)" }); },
  },
  {
    id: "proc.receive_duplicate", category: "procedure", title: "sp_receive_goods: duplicate posting of receipt 7001",
    description: "Receipt 7001 was already posted by the original script. Posting it again is refused by the pending-status check (sequentially; the concurrent case is finding F1, see Concurrency).",
    expected: "failed", expectNoChanges: true, mutating: true, watch: ["goods_receipt", "goods_receipt_line", "product_inventory"], objects: ["sp_receive_goods"],
    async run(ctx) { await ctx.exec("CALL sp_receive_goods(?)", [7001]); },
  },
  {
    id: "proc.receive_missing_inventory", category: "procedure", title: "sp_receive_goods: product without an inventory record",
    description: "Receipt 7202 contains product 9301, which has no product_inventory row. The UPDATE matches 0 rows and the procedure signals.",
    expected: "failed", expectNoChanges: true, mutating: true, watch: ["goods_receipt", "goods_receipt_line", "product_inventory"], objects: ["sp_receive_goods"],
    async setup(s) {
      await s.exec("INSERT INTO product (product_id, product_name, supplier_id, list_price, is_active) VALUES (9301, 'Lab Stool (no inventory row)', 10, 5000, TRUE)");
      await s.exec("INSERT INTO goods_receipt (receipt_id, receipt_date, receipt_status) VALUES (7202, '2026-11-10', 'pending')");
      await s.exec("INSERT INTO goods_receipt_line (receipt_id, product_id, quantity_received) VALUES (7202, 9301, 4)");
    },
    async run(ctx) { await ctx.exec("CALL sp_receive_goods(?)", [7202]); },
  },
  {
    id: "proc.award_loyalty", category: "procedure", title: "sp_award_loyalty: award points for delivered order 5001",
    description: "Setup ships and delivers order 5001 (44,000 + 2 x 11,500 = 67,000). The procedure awards FLOOR(total/100) = 670 points to every delivered, not-yet-awarded order up to the cutoff, and returns the total through an OUT parameter.",
    expected: "committed", mutating: true, watch: ["loyalty_award", "sales_order"], objects: ["sp_award_loyalty"],
    inputs: [{ name: "cutoff", label: "Cutoff date", type: "date", default: "2026-11-30" }],
    async setup(s) {
      await s.exec("UPDATE sales_order SET order_status='shipped' WHERE order_id=5001");
      await s.exec("UPDATE sales_order SET order_status='delivered' WHERE order_id=5001");
    },
    async run(ctx, input) {
      await ctx.exec("CALL sp_award_loyalty(?, @furni_points)", [String(input.cutoff ?? "2026-11-30")], { checkpoint: "After CALL (procedure committed)" });
      await readOut(ctx, "@furni_points", "awarded_points");
    },
  },
  {
    id: "proc.award_loyalty_null", category: "procedure", title: "sp_award_loyalty: missing cutoff date",
    description: "A NULL cutoff is rejected before the transaction starts ('Cutoff date is required').",
    expected: "failed", expectNoChanges: true, mutating: true, watch: ["loyalty_award"], objects: ["sp_award_loyalty"],
    async run(ctx) { await ctx.exec("CALL sp_award_loyalty(NULL, @furni_points)"); },
  },
  {
    id: "proc.build_settlements", category: "procedure", title: "sp_build_supplier_settlements: November settlement",
    description: "Sums delivered order lines per supplier for the period (grouped by order_date, finding F15) and upserts one settlement row per supplier. The total comes back through an OUT parameter.",
    expected: "committed", mutating: true, watch: ["supplier_settlement"], objects: ["sp_build_supplier_settlements"],
    inputs: [
      { name: "start", label: "Period start", type: "date", default: "2026-11-01" },
      { name: "end", label: "Period end", type: "date", default: "2026-11-30" },
    ],
    async run(ctx, input) {
      await ctx.exec("CALL sp_build_supplier_settlements(?, ?, @furni_total)", [String(input.start ?? "2026-11-01"), String(input.end ?? "2026-11-30")], { checkpoint: "After CALL (procedure committed)" });
      await readOut(ctx, "@furni_total", "total_settled");
    },
  },
  {
    id: "proc.build_settlements_invalid", category: "procedure", title: "sp_build_supplier_settlements: period ends before it starts",
    description: "An end date before the start date is rejected with 'Invalid settlement period'.",
    expected: "failed", expectNoChanges: true, mutating: true, watch: ["supplier_settlement"], objects: ["sp_build_supplier_settlements"],
    async run(ctx) { await ctx.exec("CALL sp_build_supplier_settlements('2026-11-30', '2026-11-01', @furni_total)"); },
  },
  {
    id: "proc.queue_reorders", category: "procedure", title: "sp_queue_reorders: queue low-stock products",
    description: "Every product at or below its reorder point gets an open reorder request of GREATEST(reorder_qty, reorder_point - qty_on_hand). The OUT value counts products processed, not rows inserted (finding F13).",
    expected: "committed", mutating: true, watch: ["reorder_request", "product_inventory"], objects: ["sp_queue_reorders"],
    inputs: [{ name: "date", label: "Request date", type: "date", default: "2026-11-12" }],
    async run(ctx, input) {
      await ctx.exec("CALL sp_queue_reorders(?, @furni_queued)", [String(input.date ?? "2026-11-12")], { checkpoint: "After CALL (procedure committed)" });
      await readOut(ctx, "@furni_queued", "queued");
    },
  },
];

// ------------------------------------------------------------------ triggers

const triggers: ScenarioDef[] = [
  {
    id: "trig.valid_chain", category: "trigger", title: "Order lifecycle: draft → placed → confirmed → shipped → delivered",
    description: "A new order passes bi_sales_order (active customer) and bi_order_line (draft order, active product). Each status change passes bu_sales_order and fires au_sales_order, which writes one history row and one audit row.",
    expected: "committed", mutating: true, watch: ORDER_TABLES, objects: ["bi_sales_order", "bi_order_line", "bu_sales_order", "au_sales_order"],
    async run(ctx) {
      await ctx.exec("INSERT INTO sales_order (order_id, customer_id, order_date, order_status) VALUES (9201, 1, ?, 'draft')", [ORDER_DATE], { checkpoint: "Draft order inserted" });
      await ctx.exec("INSERT INTO order_line (order_id, product_id, quantity, unit_price) VALUES (9201, 202, 1, 38000)", [], { checkpoint: "Line added to the draft" });
      for (const s of ["placed", "confirmed", "shipped", "delivered"])
        await ctx.exec("UPDATE sales_order SET order_status=? WHERE order_id=9201", [s], { checkpoint: `Status → ${s}` });
    },
  },
  {
    id: "trig.cancellation_branches", category: "trigger", title: "Cancellation from draft, placed and confirmed",
    description: "bu_sales_order allows cancellation from draft, placed and confirmed only. Three orders take the three branches; each cancellation is logged by au_sales_order.",
    expected: "committed", mutating: true, watch: ORDER_TABLES, objects: ["bu_sales_order", "au_sales_order"],
    async run(ctx) {
      const branches: [number, string[]][] = [[9211, []], [9212, ["placed"]], [9213, ["placed", "confirmed"]]];
      for (const [id, path] of branches) {
        ctx.milestone(`Order ${id}: draft${path.map((p) => ` → ${p}`).join("")} → cancelled`);
        await ctx.exec("INSERT INTO sales_order (order_id, customer_id, order_date, order_status) VALUES (?, 2, ?, 'draft')", [id, ORDER_DATE]);
        for (const s of path) await ctx.exec("UPDATE sales_order SET order_status=? WHERE order_id=?", [s, id]);
        await ctx.exec("UPDATE sales_order SET order_status='cancelled' WHERE order_id=?", [id], { checkpoint: `Order ${id} cancelled` });
      }
    },
  },
  {
    id: "trig.invalid_transitions", category: "trigger", title: "Invalid transitions rejected by bu_sales_order",
    description: "Delivered → cancelled, placed → delivered (skipping steps) and confirmed → draft are refused with the trigger's own SIGNAL. No history or audit row is written.",
    expected: "failed", expectNoChanges: true, mutating: true, watch: ORDER_TABLES, objects: ["bu_sales_order"],
    async run(ctx) {
      await ctx.exec("UPDATE sales_order SET order_status='cancelled' WHERE order_id=5002", [], { expectError: true });
      await ctx.exec("UPDATE sales_order SET order_status='delivered' WHERE order_id=5004", [], { expectError: true });
      await ctx.exec("UPDATE sales_order SET order_status='draft' WHERE order_id=5001", [], { expectError: true });
      ctx.milestone("An UPDATE that keeps the same status is always allowed (and logs nothing):");
      await ctx.exec("UPDATE sales_order SET order_status='delivered' WHERE order_id=5002");
      ctx.outcome("failed");
    },
  },
  {
    id: "trig.inactive_customer", category: "trigger", title: "bi_sales_order: order for an inactive customer",
    description: "Setup deactivates customer 3. Inserting an order for that customer is refused ('Orders require an active customer').",
    expected: "failed", expectNoChanges: true, mutating: true, watch: [...ORDER_TABLES, "customer"], objects: ["bi_sales_order"],
    async setup(s) { await s.exec("UPDATE customer SET is_active=FALSE WHERE customer_id=3"); },
    async run(ctx) { await ctx.exec("INSERT INTO sales_order (order_id, customer_id, order_date, order_status) VALUES (9221, 3, ?, 'draft')", [ORDER_DATE]); },
  },
  {
    id: "trig.line_on_placed_order", category: "trigger", title: "bi_order_line: line added to a placed order (finding F4)",
    description: "Order 5004 is placed. bi_order_line only accepts lines for draft orders, which is also why the seed rows cannot be replayed once the triggers exist.",
    expected: "failed", expectNoChanges: true, mutating: true, watch: ORDER_TABLES, objects: ["bi_order_line"],
    async run(ctx) { await ctx.exec("INSERT INTO order_line (order_id, product_id, quantity, unit_price) VALUES (5004, 202, 1, 38000)"); },
  },
  {
    id: "trig.price_audit", category: "trigger", title: "au_product: price changes are audited",
    description: "A list-price change writes an audit row with the old and new price. An UPDATE that does not change the price writes nothing.",
    expected: "committed", mutating: true, watch: ["product", "audit_log"], objects: ["au_product"],
    async run(ctx) {
      await ctx.exec("UPDATE product SET list_price = list_price + 500 WHERE product_id = 101", [], { checkpoint: "Price raised by 500" });
      await ctx.exec("UPDATE product SET list_price = list_price WHERE product_id = 101", [], { checkpoint: "Same price (no audit row)" });
      await ctx.exec("UPDATE product SET list_price = list_price - 250 WHERE product_id = 101", [], { checkpoint: "Price lowered by 250" });
    },
  },
];

// ------------------------------------------------------------------ functions

const fnDiscount: [unknown, unknown, string][] = [
  [45000, 10, "the source script's own check"], [99.99, 33.33, "rounding to 2 decimals"], [100, 0, "no discount"],
  [100, 100, "full discount"], [null, 10, "NULL price"], [100, null, "NULL discount"], [-1, 10, "negative price"],
  [100, 101, "discount above 100"], [100, -5, "negative discount"],
];
const fnWarranty: [unknown, unknown, string][] = [
  ["2026-11-04", 36, "the source script's own check"], ["2024-01-31", 1, "month-end clamps to 29 Feb (leap year)"],
  ["2026-11-04", 0, "0 months"], ["2026-11-04", 120, "upper bound"], ["2026-11-04", 121, "above 120"],
  ["2026-11-04", -1, "negative months"], [null, 12, "NULL date"], ["2026-11-04", null, "NULL months"],
];

const functions: ScenarioDef[] = [
  {
    id: "fn.discounted_price", category: "function", title: "fn_discounted_price: valid, NULL and invalid inputs",
    description: "DETERMINISTIC NO SQL. Returns ROUND(price * (1 - pct/100), 2), or NULL when an input is NULL, negative, or the discount exceeds 100.",
    expected: "read_only", mutating: false, watch: [], objects: ["fn_discounted_price"],
    async run(ctx) {
      const out: Record<string, unknown>[] = [];
      for (const [p, d, why] of fnDiscount) {
        const r = await ctx.exec("SELECT fn_discounted_price(?, ?) AS result", [p, d]);
        out.push({ price: p, discount_pct: d, result: r.rows[0]?.result ?? null, case: why });
      }
      ctx.output("calls", out);
    },
  },
  {
    id: "fn.warranty_expiry", category: "function", title: "fn_warranty_expiry: valid, NULL and invalid inputs",
    description: "DETERMINISTIC NO SQL. Returns DATE_ADD(date, INTERVAL months MONTH) for 0..120 months, otherwise NULL.",
    expected: "read_only", mutating: false, watch: [], objects: ["fn_warranty_expiry"],
    async run(ctx) {
      const out: Record<string, unknown>[] = [];
      for (const [d, m, why] of fnWarranty) {
        const r = await ctx.exec("SELECT fn_warranty_expiry(?, ?) AS result", [d, m]);
        out.push({ purchase_date: d, months: m, result: r.rows[0]?.result ?? null, case: why });
      }
      ctx.output("calls", out);
    },
  },
];

// ------------------------------------------------------------------ transactions

const transactions: ScenarioDef[] = [
  {
    id: "tx.savepoint", category: "transaction", title: "SAVEPOINT and ROLLBACK TO SAVEPOINT, then COMMIT",
    description: "A price change is kept, a later stock change is undone with ROLLBACK TO SAVEPOINT, and COMMIT persists only the first change (plus the audit row au_product wrote inside the transaction).",
    expected: "committed", mutating: true, watch: ["product", "product_inventory", "audit_log"], objects: ["au_product"],
    async run(ctx) {
      await ctx.exec("START TRANSACTION");
      await ctx.exec("UPDATE product SET list_price = list_price + 100 WHERE product_id = 102", [], { checkpoint: "Price change (uncommitted)", persisted: false });
      await ctx.exec("SAVEPOINT before_inventory_edit");
      await ctx.exec("UPDATE product_inventory SET qty_on_hand = qty_on_hand - 1 WHERE product_id = 101 AND qty_on_hand >= 1", [], { checkpoint: "Stock change after the savepoint (uncommitted)", persisted: false });
      await ctx.exec("ROLLBACK TO SAVEPOINT before_inventory_edit", [], { checkpoint: "Rolled back to the savepoint (still uncommitted)", persisted: false });
      await ctx.exec("RELEASE SAVEPOINT before_inventory_edit");
      await ctx.exec("COMMIT", [], { checkpoint: "COMMIT" });
    },
  },
  {
    id: "tx.rollback", category: "transaction", title: "Full ROLLBACK discards every change",
    description: "A price change and the audit row its trigger writes are visible inside the transaction, then ROLLBACK discards both (source lines 1117-1119).",
    expected: "rolled_back", expectNoChanges: true, mutating: true, watch: ["product", "audit_log"], objects: ["au_product"],
    async run(ctx) {
      await ctx.exec("START TRANSACTION");
      await ctx.exec("UPDATE product SET list_price = list_price + 50 WHERE product_id = 102", [], { checkpoint: "Attempted change (uncommitted)", persisted: false });
      await ctx.exec("ROLLBACK", [], { checkpoint: "After ROLLBACK" });
      ctx.outcome("rolled_back");
    },
  },
  {
    id: "tx.read_only", category: "transaction", title: "START TRANSACTION READ ONLY refuses writes",
    description: "Reads work; the UPDATE fails with error 1792 before touching any row. This is the mode the SQL playground uses.",
    expected: "read_only", mutating: true, watch: ["product_inventory"], objects: [],
    async run(ctx) {
      await ctx.exec("START TRANSACTION READ ONLY");
      await ctx.exec("SELECT product_id, qty_on_hand FROM product_inventory ORDER BY product_id");
      await ctx.exec("UPDATE product_inventory SET qty_on_hand = qty_on_hand + 1 WHERE product_id = 101", [], { expectError: true });
      await ctx.exec("COMMIT");
      ctx.outcome("read_only");
    },
  },
  {
    id: "tx.locking_reads", category: "transaction", title: "Locking reads: FOR SHARE and FOR UPDATE",
    description: "FOR SHARE takes shared row locks, FOR UPDATE exclusive ones, held until the transaction ends (source lines 1121-1140). A single session sees no blocking; the Concurrency lab shows a second session waiting.",
    expected: "read_only", mutating: true, watch: ["product_inventory"], objects: [],
    async run(ctx) {
      await ctx.exec("START TRANSACTION");
      await ctx.exec("SELECT product_id, qty_on_hand FROM product_inventory WHERE product_id = 101 FOR SHARE");
      await ctx.exec("COMMIT");
      await ctx.exec("START TRANSACTION");
      await ctx.exec("SELECT product_id, qty_on_hand FROM product_inventory WHERE product_id BETWEEN 101 AND 201 FOR UPDATE");
      await ctx.exec("SAVEPOINT before_inventory_edit");
      await ctx.exec("UPDATE product_inventory SET qty_on_hand = qty_on_hand - 1 WHERE product_id = 101 AND qty_on_hand >= 1", [], { checkpoint: "Edit under the lock (uncommitted)", persisted: false });
      await ctx.exec("ROLLBACK TO SAVEPOINT before_inventory_edit");
      await ctx.exec("COMMIT", [], { checkpoint: "COMMIT (nothing to persist)" });
    },
  },
];

// ------------------------------------------------------------------ concurrency

const concurrency: ScenarioDef[] = [
  {
    id: "cc.for_update_blocking", category: "concurrency", title: "FOR UPDATE blocks a second writer until COMMIT",
    description: "Session X locks inventory row 101 and edits it. Session Y's UPDATE of the same row waits; when X commits, Y proceeds and applies its change on top.",
    expected: "committed", mutating: true, watch: ["product_inventory"], objects: [],
    async run(ctx) {
      const x = await ctx.session("Session X");
      const y = await ctx.session("Session Y");
      await ctx.exec("SET SESSION innodb_lock_wait_timeout = 10", [], { session: y });
      await ctx.exec("START TRANSACTION", [], { session: x });
      await ctx.exec("SELECT product_id, qty_on_hand FROM product_inventory WHERE product_id = 101 FOR UPDATE", [], { session: x });
      await ctx.exec("UPDATE product_inventory SET qty_on_hand = qty_on_hand - 1 WHERE product_id = 101", [], { session: x });
      const py = ctx.exec("UPDATE product_inventory SET qty_on_hand = qty_on_hand - 2 WHERE product_id = 101", [], { session: y });
      if (await ctx.stillRunning(py, 400)) {
        const state = await ctx.threadState(y);
        ctx.milestone(`Observed: Session Y is still waiting after 400 ms (thread state: ${state ?? "n/a"})`);
        ctx.output("y_blocked", true);
      } else {
        ctx.milestone("Session Y finished before X committed (not expected)");
        ctx.output("y_blocked", false);
      }
      await ctx.exec("COMMIT", [], { session: x });
      const r = await py;
      ctx.milestone(`Session Y's UPDATE completed ${r.elapsedMs} ms after it was issued`);
      ctx.output("y_wait_ms", r.elapsedMs);
      await ctx.checkpoint("Both changes committed");
    },
  },
  {
    id: "cc.lock_wait_timeout", category: "concurrency", title: "Bounded lock wait: innodb_lock_wait_timeout = 1",
    description: "Session X holds the row lock and does not commit. Session Y gives up after 1 second with ER_LOCK_WAIT_TIMEOUT (only Y's statement is rolled back). X then rolls back.",
    expected: "failed", expectNoChanges: true, mutating: true, watch: ["product_inventory"], objects: [],
    async run(ctx) {
      const x = await ctx.session("Session X");
      const y = await ctx.session("Session Y");
      await ctx.exec("SET SESSION innodb_lock_wait_timeout = 1", [], { session: y });
      await ctx.exec("START TRANSACTION", [], { session: x });
      await ctx.exec("SELECT product_id, qty_on_hand FROM product_inventory WHERE product_id = 101 FOR UPDATE", [], { session: x });
      const r = await ctx.exec("UPDATE product_inventory SET qty_on_hand = qty_on_hand - 1 WHERE product_id = 101", [], { session: y, expectError: true });
      ctx.output("y_waited_ms", r.elapsedMs);
      ctx.output("y_error", r.error?.code ?? null);
      await ctx.exec("ROLLBACK", [], { session: x });
      ctx.outcome("failed");
    },
  },
  {
    id: "cc.repeatable_read", category: "concurrency", title: "REPEATABLE READ: a consistent snapshot ignores a later commit",
    description: "Session R reads stock in a REPEATABLE READ transaction. Session W commits an increase. R's next plain read still sees the old value (same snapshot); a locking read (FOR SHARE) sees the latest committed value.",
    expected: "committed", mutating: true, watch: ["product_inventory"], objects: [],
    async run(ctx) {
      const r = await ctx.session("Session R");
      const w = await ctx.session("Session W");
      await ctx.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ", [], { session: r });
      await ctx.exec("START TRANSACTION", [], { session: r });
      const first = await ctx.exec("SELECT qty_on_hand FROM product_inventory WHERE product_id = 202", [], { session: r });
      await ctx.exec("UPDATE product_inventory SET qty_on_hand = qty_on_hand + 1 WHERE product_id = 202", [], { session: w });
      await ctx.checkpoint("W committed (autocommit)");
      const second = await ctx.exec("SELECT qty_on_hand FROM product_inventory WHERE product_id = 202", [], { session: r });
      const locking = await ctx.exec("SELECT qty_on_hand FROM product_inventory WHERE product_id = 202 FOR SHARE", [], { session: r });
      await ctx.exec("COMMIT", [], { session: r });
      ctx.output("first_read", first.rows[0]?.qty_on_hand);
      ctx.output("second_read_same_snapshot", second.rows[0]?.qty_on_hand);
      ctx.output("locking_read_latest", locking.rows[0]?.qty_on_hand);
      ctx.note("SET TRANSACTION ISOLATION LEVEL without SESSION applies to the next transaction only (finding F17).");
    },
  },
  {
    id: "cc.f1_double_posting", category: "concurrency", title: "Finding F1: concurrent sp_receive_goods double-posts a receipt",
    description: "Session X holds inventory row 202 so that sessions A and B both pass sp_receive_goods' non-locking 'pending' check and then wait on the row. When X commits, both add 5 units; the second UPDATE of goods_receipt matches 0 rows and is not checked, so both calls succeed and stock rises by 10.",
    expected: "committed", mutating: true, watch: ["goods_receipt", "goods_receipt_line", "product_inventory"], objects: ["sp_receive_goods"],
    async setup(s) {
      await s.exec("INSERT INTO goods_receipt (receipt_id, receipt_date, receipt_status) VALUES (7301, '2026-11-10', 'pending')");
      await s.exec("INSERT INTO goods_receipt_line (receipt_id, product_id, quantity_received) VALUES (7301, 202, 5)");
    },
    async run(ctx) {
      const x = await ctx.session("Session X");
      const a = await ctx.session("Session A");
      const b = await ctx.session("Session B");
      for (const s of [a, b]) await ctx.exec("SET SESSION innodb_lock_wait_timeout = 10", [], { session: s });
      const start = await ctx.exec("SELECT qty_on_hand FROM product_inventory WHERE product_id = 202");
      await ctx.exec("START TRANSACTION", [], { session: x });
      await ctx.exec("SELECT qty_on_hand FROM product_inventory WHERE product_id = 202 FOR UPDATE", [], { session: x });
      const pa = ctx.exec("CALL sp_receive_goods(7301)", [], { session: a });
      const aWaiting = await ctx.stillRunning(pa, 300);
      const pb = ctx.exec("CALL sp_receive_goods(7301)", [], { session: b });
      const bWaiting = await ctx.stillRunning(pb, 300);
      ctx.milestone(`Observed: A ${aWaiting ? "is" : "is NOT"} waiting, B ${bWaiting ? "is" : "is NOT"} waiting on the inventory row lock (both already passed the pending check)`);
      await ctx.exec("COMMIT", [], { session: x });
      const settled = await Promise.allSettled([pa, pb]);
      const before = Number(start.rows[0]?.qty_on_hand);
      const end = await ctx.exec("SELECT qty_on_hand FROM product_inventory WHERE product_id = 202");
      const after = Number(end.rows[0]?.qty_on_hand);
      ctx.output("stock_before", before);
      ctx.output("stock_after", after);
      ctx.output("calls_succeeded", settled.filter((s) => s.status === "fulfilled").length);
      ctx.output("race_reproduced", after - before === 10);
      ctx.milestone(after - before === 10 ? "Race reproduced: 5 received units were added twice" : `Race not reproduced this time (stock changed by ${after - before})`);
    },
  },
  {
    id: "cc.f1_mitigated", category: "concurrency", title: "F1 mitigation: a named lock serialises receipt posting",
    description: "The application wraps sp_receive_goods in GET_LOCK per receipt. B waits for A's lock, then its CALL is refused by the pending check because A has already posted. Stock rises by 5 only.",
    expected: "committed", mutating: true, watch: ["goods_receipt", "goods_receipt_line", "product_inventory"], objects: ["sp_receive_goods"],
    async setup(s) {
      await s.exec("INSERT INTO goods_receipt (receipt_id, receipt_date, receipt_status) VALUES (7301, '2026-11-10', 'pending')");
      await s.exec("INSERT INTO goods_receipt_line (receipt_id, product_id, quantity_received) VALUES (7301, 202, 5)");
    },
    async run(ctx) {
      const lock = ctx.lockName("receipt:7301");
      const x = await ctx.session("Session X");
      const a = await ctx.session("Session A");
      const b = await ctx.session("Session B");
      await ctx.exec("START TRANSACTION", [], { session: x });
      await ctx.exec("SELECT qty_on_hand FROM product_inventory WHERE product_id = 202 FOR UPDATE", [], { session: x });
      await ctx.exec("SELECT GET_LOCK(?, 10) AS got", [lock], { session: a });
      const pa = ctx.exec("CALL sp_receive_goods(7301)", [], { session: a });
      await ctx.stillRunning(pa, 200);
      const pbLock = ctx.exec("SELECT GET_LOCK(?, 10) AS got", [lock], { session: b });
      const bWaiting = await ctx.stillRunning(pbLock, 300);
      ctx.milestone(`Observed: B ${bWaiting ? "is waiting for" : "did NOT wait for"} A's named lock`);
      await ctx.exec("COMMIT", [], { session: x });
      await pa;
      await ctx.exec("SELECT RELEASE_LOCK(?) AS released", [lock], { session: a });
      await pbLock;
      const rb = await ctx.exec("CALL sp_receive_goods(7301)", [], { session: b, expectError: true });
      await ctx.exec("SELECT RELEASE_LOCK(?) AS released", [lock], { session: b });
      ctx.output("second_call_refused", !!rb.error);
      ctx.output("second_call_error", rb.error?.message ?? null);
    },
  },
];

export const SCENARIOS: ScenarioDef[] = [...procedures, ...triggers, ...functions, ...transactions, ...concurrency];

export function getScenario(id: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

/** Plain, serialisable description for the UI (no functions). */
export function scenarioCatalog(category?: ScenarioDef["category"]) {
  return SCENARIOS.filter((s) => !category || s.category === category).map(({ id, category, title, description, expected, provenance, objects, inputs, mutating }) => ({
    id, category, title, description, expected, provenance: provenance ?? "observed", objects, inputs: inputs ?? [], mutating,
  }));
}
export type ScenarioSummary = ReturnType<typeof scenarioCatalog>[number];
