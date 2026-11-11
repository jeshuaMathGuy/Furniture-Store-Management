# SQL lab (Stage 6, minimal scope)

## Pages

| Route | What it does |
|---|---|
| `/lab/sql` | Read-only playground: a textarea editor, 8 guided examples, a result grid with column types, and `EXPLAIN FORMAT=JSON` |
| `/lab/procedures`, `/lab/triggers`, `/lab/functions`, `/lab/transactions`, `/lab/concurrency` | The scenario lab, filtered by category. Each run shows a trace (see [TRACES.md](TRACES.md)) |
| `/lab/traces` | All scenarios on one page, with the trace player |
| `/lab/schema`, `/lab/views` | Placeholders (not built) |

Every page requires sign-in and the `lab:read` permission. Running a scenario requires `lab:scenario:run`, and resetting the sandbox requires `lab:reset` (student and administrator roles). All permissions are checked on the server, in `apps/web/src/components/lab/server/actions.ts`.

## Security model for user-typed SQL

1. **Privilege boundary (the actual control).** User SQL runs only through the `labReader()` pool. The MySQL account `lab_reader` has SELECT on the lab, fixture and teaching schemas, SHOW VIEW on the lab schema, and EXECUTE on the 2 functions. It has no privileges on the application database, and MySQL refuses every write (this is tested).
2. **Parser classification (defence in depth).** `packages/database/src/lab/classifier.ts` parses with node-sql-parser (MySQL dialect). It accepts exactly one SELECT, WITH, EXPLAIN [FORMAT=JSON|TREE] of a SELECT, SHOW, or DESCRIBE. It rejects multiple statements, DML, DDL, CALL, SET, locking reads, `SELECT ... INTO`, `EXPLAIN ANALYZE`, and the named-lock and file functions (`GET_LOCK`, `LOAD_FILE`, ...). The parser is not the security boundary.
3. **Execution limits** (`executor.ts`): `START TRANSACTION READ ONLY`, `SET SESSION MAX_EXECUTION_TIME=3000`, and `sql_select_limit` set to 501. The result is cut to 500 rows and the truncation is reported. A watchdog runs `KILL QUERY` from a second session if a query outlives the limit. Afterwards the connection always gets ROLLBACK, `RELEASE_ALL_LOCKS()` and its session limits restored; if any of that fails, the connection is destroyed. MySQL's own error text is shown.

`SLEEP()` and `BENCHMARK()` stop at the time limit without raising an error, so the UI flags them by elapsed time.

## Scenarios (server-defined, `lab_operator` only)

Defined in `packages/database/src/lab/scenarios.ts`. The client sends only a scenario id and typed date inputs, never SQL.

* **Procedures.** `sp_confirm_order`: success, unknown order, wrong status, empty order, insufficient stock (a partial deduction that is rolled back), and missing inventory record. `sp_receive_goods`: success, duplicate posting, and missing inventory record. `sp_award_loyalty`: success (670 points) and NULL cutoff. `sp_build_supplier_settlements`: success and invalid period. `sp_queue_reorders`.
* **Triggers.** The valid chain draft → placed → confirmed → shipped → delivered, the three cancellation branches, invalid transitions (with MySQL's error), inactive customer, a line on a placed order (F4), and the price audit.
* **Functions.** Both functions with valid, NULL and out-of-range inputs.
* **Transactions.** SAVEPOINT / ROLLBACK TO SAVEPOINT / COMMIT, full ROLLBACK, READ ONLY, and locking reads.
* **Concurrency (real sessions).** FOR UPDATE blocking, a 1-second lock-wait timeout, the REPEATABLE READ snapshot, the F1 double-posting race (reproduced live) and its GET_LOCK mitigation.

Nothing in the lab is simulated: every trace has `provenance: "observed"`. The one effect that cannot be observed is the work a procedure rolls back inside its own transaction (F3). For that case, the trace states that nothing persisted and checks it.

## Sandbox reset without root

`setup.ts` (`rebuildLab`) now captures `<lab>_fixture`. This schema holds a copy of every lab table, plus `lab_meta_*` tables that record trigger, routine and view definitions. `resetLabSandbox` (`fixture.ts`) restores the sandbox with lab_operator DML only, inside one transaction with `foreign_key_checks=0`. Triggers cannot be disabled, so the refill order satisfies them: active customers and products first, then orders inserted as draft, then lines, then the draft orders deleted (no cascade while FK checks are off) and re-inserted with their real status. The UPDATE triggers never fire. AUTO_INCREMENT counters are not rewound, because that needs ALTER. Every scenario run starts with a reset, and runs and resets are serialised by `GET_LOCK('furni:lab:<labdb>')`.

New grants (`ensureDbUsers`): SELECT on `<lab>_fixture.*` to lab_reader and lab_operator, and SHOW VIEW on the lab schema to lab_reader (so EXPLAIN works over the views). There are no grants on the application database.

## Tests

* `database/tests/lab-sql.test.ts`: the classifier, MySQL denials, the row cap, the time limit, EXPLAIN, and real errors.
* `database/tests/lab-scenarios.test.ts`: every scenario's status and trace validation, concrete outcomes, and reset determinism with the app DB untouched.
* `apps/web/e2e/lab-sql.spec.ts`

Run the database tests with `FURNI_TEST_PREFIX=furni_s67 pnpm test:db`.
