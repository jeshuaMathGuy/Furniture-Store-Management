# Normalization Laboratory

Page: `/lab/normalization` (public, read-only). Module: `packages/database/src/lab/normalization.ts`. Tests: `database/tests/normalization-lab.test.ts`, `apps/web/e2e/normalization.spec.ts`.

Every stage is the decomposition the source script (`database/original/furniture_store_normalized.sql`) performs. Keys, normal forms, lossless-join results and dependency preservation are **computed** from the declared dependencies, using attribute closure, candidate-key search, the chase and the standard preservation test. They are not hard-coded.

## Dependency bases

| Basis | Meaning | Used in proofs? |
|---|---|---|
| declared | Enforced by a PRIMARY KEY, a UNIQUE key or a generated column in the source DDL, or copied from a relation where it is a key | yes |
| assumed | A business rule the script relies on (often checked by its `functional_dependency_consistency` query, lines 1066–1079) but not enforced on that relation | yes, and listed as an assumption of the proof |
| observed-in-sample | Holds in the sample rows only, e.g. `order_id → plan_code`, `city → region` | **never** |

## Stages

| Stage | Source lines | Violation removed (computed) | Decomposition | Lossless join | Preservation |
|---|---|---|---|---|---|
| UNF | 58–128 | — (`items`, `certifications`, `service_regions` are JSON arrays) | — | — | — |
| 1NF | 130–181 | non-atomic attributes | unnest with `JSON_TABLE` → `nf1_order_line`, `nf1_supplier_capability` | nesting by `order_id` / `supplier_id` inverts it, given (order_id, product_id) is unique, no array is empty and every item's product exists | n/a (not a projection) |
| 2NF | 183–244 | partial dependencies `order_id → header` and `product_id → product, supplier` on key (order_id, product_id) | `nf2_order`, `nf2_order_line`, `nf2_product` | chase; R₁ ∩ R₂ = order_id → R₁, then product_id → R₃ | **not preserved:** `plan_code → supplier_id` and `(order_id, supplier_id) → plan_code` span relations until 3NF restores them |
| 3NF | 246–333 | transitive dependencies via customer_id, postal_code, supplier_id and plan_code | `sales_order`, `customer`, `postal_area`; `product`, `supplier`; `order_line`, `product(product_id, supplier_id)`, `nf3_order_supplier_plan`, `warranty_plan` | chase, for all three decompositions | preserved |
| BCNF | 335–347 | `plan_code → supplier_id`: the determinant is not a superkey of nf3_order_supplier_plan, whose keys are (order_id, supplier_id) and (order_id, plan_code) | `order_plan(order_id, plan_code)`, `warranty_plan(plan_code, supplier_id)` | R₁ ∩ R₂ = plan_code → R₂ | **not preserved:** `(order_id, supplier_id) → plan_code` (audit F16) |
| 4NF | 349–371, 979–1053 | MVD `supplier_id ↠ certification \| service_region` | `supplier_certification`, `supplier_service_region` | Fagin: R₁ ∩ R₂ = supplier_id ↠ R₁ − R₂ | no FDs to preserve |

Notes:

* `nf1_order_line` has no `order_status` column, so the script re-reads it from `unf_sales_order` at line 195. The 3NF order-line universe adds `supplier_id` through `product_id → supplier_id`. The BCNF split reuses `warranty_plan`. `order_line.line_total` is a generated column, so it is left out of the normal-form analysis.
* F16 counterexample (in memory): add plan CEDAR60 for supplier 10 to warranty_plan and add (5001, CEDAR60) to order_plan. Every key still holds, but order 5001 now has two plans for supplier 10.
* F2: the snapshot is taken before line 841, so the 2NF→3NF order reconstruction finds 0 differences. If `sp_confirm_order(5001)`'s status change is applied first, as the script does, it finds exactly the 1 violation the script reports.

## What the sample checks can and cannot prove

Two kinds of check run live, as `lab_reader`, against the teaching snapshot, once in SQL and once in memory (the two must agree):

* reconstruction checks: missing and spurious tuples when the decomposed relations are joined back;
* key, FD and MVD checks: on every relation of the stage.

All of them report 0 violations. That is **evidence**: this sample satisfies the assumed dependencies, and these particular decompositions lost nothing. It is **not proof**. With only 3 orders, 4 products and 2 suppliers, a false dependency can easily hold by accident; `order_id → plan_code` is an example. The structural results are the proofs. They hold for every instance that satisfies the declared and assumed dependencies, and they are only as good as those assumptions. A corrupted sample (tests change one warranty duration, add one order_plan row, drop one JSON item, and so on) is detected by the instance checks, while the structural results stay the same.
