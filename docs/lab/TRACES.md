# Execution traces (Stage 7, minimal scope)

`packages/database/src/lab/trace.ts` and `scenario-runner.ts` produce the `ExecutionTrace` contract from `@furni/shared`, unchanged. Lab extras go in `result`.

A run goes through these steps:

1. Reset the sandbox from the fixture and run the scenario's setup (preconditions).
2. Take a `before` snapshot of the watched tables. `product_inventory`, `sales_order`, `loyalty_award` and `supplier_settlement` are always included for mutating scenarios.
3. Execute. Each statement becomes a `statement` event (MySQL-formatted SQL and affected rows). Concurrent sessions are prefixed `[Session X]`. Errors become `error` events with MySQL's code and SQLSTATE. Scenarios can add `milestone` events (for example "Session Y is still waiting after 400 ms").
4. Take checkpoints after selected statements. Each checkpoint is a diff against `before`. Checkpoints taken inside an open transaction are marked `persisted: false`, so the player labels them "ATTEMPTED · not persisted" and keeps them apart from what was committed.
5. Read new `audit_log` and `order_status_history` rows from the diffs. These become `trigger_effect` events (`au_sales_order` or `au_product`).
6. Take an `after` snapshot, compute `changes = diffSnapshots(before, after)`, and record the outcome. An uncaught error gives `failed`. Otherwise the scenario's explicit outcome is used (`rolled_back`, `read_only`); if there is none, the run is `committed` when rows changed and `read_only` when nothing changed.
7. Validate (`validateTrace`):
   * re-read the after-state from MySQL and compare it row by row with `trace.after`;
   * check that `trace.changes` equals the recomputed diff;
   * check that the outcome event matches the status;
   * check that a failed run carries the error;
   * for failed or rolled-back runs that must not persist anything, check that `changes` is empty.

   Any mismatch is listed in the trace and the player shows "VALIDATION MISMATCH". Nothing is hidden.

The player (`apps/web/src/components/lab/trace-player.tsx`) has Reset, Previous and Next controls and a clickable timeline. The diff for the selected step uses sage for added rows, clay for updated rows and charcoal with strike-through for removed rows, each with a text badge. The player also shows the MySQL error, the output values (OUT parameters, observed timings) and the validation checks.

## Not built (reduced scope)

* Traces are not saved to `demo_execution` or `demo_execution_step`, and there is no saved-trace history.
* There is no relational-graph layer and no business-dashboard layer, and the player does not auto-play.
