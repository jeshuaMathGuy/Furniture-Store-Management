# Database verification gate: Stage 1

**Run:** `pnpm typecheck && pnpm test:db` · originally MySQL 8.4.13 / Node 22 (Docker); **re-verified natively on MySQL 8.0.43 / Node 26.13: 101 passed, 1 todo**
**Result:** typecheck clean · **7 files, 101 passed, 0 failed, 1 todo** (64.8 s)

The todo is explicit, not a silently skipped test: *required test 19 (execution traces match observed state)* belongs to Stage 7.

| Required DB test (Part XV §49) | Covered by | Status |
|---|---|---|
| 1 All original objects created | baseline.test.ts | ✔ |
| 2 FK constraints valid | baseline.test.ts (all 21 FKs, orphan scan) | ✔ |
| 3 Normalization snapshots reconstruct sources | teaching.test.ts | ✔ |
| 4 Dependencies and assumptions documented | SOURCE_AUDIT.md §3, F16 (normalization docs extend this in Stage 5) | ✔ (docs) |
| 5 All five procedures execute | procedures.test.ts | ✔ |
| 6 All five triggers behave | triggers-integrity.test.ts | ✔ |
| 7 Both functions | procedures.test.ts (valid, NULL, out-of-range, month-end) | ✔ |
| 8 Invalid transitions rejected | triggers-integrity.test.ts (7 cases, nothing written) | ✔ |
| 9 Inventory never negative via confirmation | procedures.test.ts | ✔ |
| 10 Failed transactions roll back | procedures.test.ts (partial deduction restored) | ✔ |
| 11 Receipts not posted twice | procedures.test.ts (sequential); concurrency.test.ts (**F1**: concurrent double posting reproduced; service mitigation verified) | ✔ |
| 12 No duplicate loyalty awards | procedures.test.ts | ✔ |
| 13 Settlement upserts | procedures.test.ts | ✔ |
| 14 Reorder uniqueness | procedures.test.ts | ✔ |
| 15 Generated line totals | triggers-integrity.test.ts | ✔ |
| 16 Views match definitions | app-services.test.ts | ✔ |
| 17 Sandbox cannot modify app DB | sandbox.test.ts | ✔ |
| 18 Reset reproduces fixtures | sandbox.test.ts (2 rebuilds plus a pristine replay give identical content) | ✔ |
| 19 Traces match observed state | – | todo (Stage 7) |
| 20 Authorization | app-services.test.ts | ✔ |

Also covered: the source file hash; extension migrations leave every original column, constraint, index, routine and trigger byte-identical; demo seeds never modify original rows; sessions store only token digests; CSRF verification.

## Defects found while building the gate

1. The runner identified generated columns with `EXTRA LIKE '%GENERATED%'`, which also matches `DEFAULT_GENERATED` (timestamp defaults). As a result, `changed_at` and similar columns were dropped when teaching snapshots were copied. Fixed by using `GENERATION_EXPRESSION <> ''`.
2. The concurrency tests polled `information_schema.INNODB_TRX`. That table is a cache that never refreshes while it is read more often than every 0.1 s, which made the tests flaky. They now poll `performance_schema.data_lock_waits` and pass 5 out of 5 repeated runs.

# Web foundation gate: Stage 2

**Run:** `pnpm typecheck` and `pnpm lint` (clean) · `pnpm e2e` against a **production build** (`next build` + `next start`)
**Result:** **17 passed, 0 failed, 0 skipped**. The full suite was green 4 runs in a row, and the filter tests passed 16 out of 16 repeated runs.

| Area (Part XV §50) | Spec | Covered |
|---|---|---|
| Functional navigation | storefront.spec.ts | every primary link, `aria-current`, real 404 status |
| Product filters and search | storefront.spec.ts | category, keyword, price ceiling, sort order, empty state, malformed parameters ignored |
| Catalog/product consistency | storefront.spec.ts | 20 database products; card opens the matching product page |
| Auth and authorization | auth.spec.ts | error is announced as an alert; next-redirect; HttpOnly and SameSite=Lax cookie; a customer sees only own orders; no record inspector and a 404 on /manage for customers; admin sees the inspector with real rows; open redirect refused; sign-out |
| Responsive layouts | responsive.spec.ts (Pixel 7) | no horizontal overflow, menu disclosure, single-column grid |
| Reduced motion | storefront.spec.ts | entrance animation disabled |

Not yet covered, by design: viewer and configurator (Stage 3), checkout and payment (Stage 4), lab features (Stages 5–7).

## Defects found while building the gate

1. **Session cookie dropped in production.** `secure` was tied to `NODE_ENV`, so the production build served over plain-HTTP localhost set a Secure cookie that the browser discarded, and nobody stayed signed in. It is now Secure exactly when the request arrived over HTTPS; `COOKIE_SECURE` overrides this.
2. **Unknown products returned 200.** The collection's `loading.tsx` wrapped the product route, so streaming began before `notFound()` ran. The loading state now lives in a `(list)` route group, and unknown products return 404.
3. **Stale filter inputs after "Clear filters".** Client navigation kept the uncontrolled inputs' old values. The form is now keyed on the active filters.
4. **Lost filter navigations.** Soft navigations between search-param variants of `/collection` sometimes fetched the payload but never committed it under Next 15.5. This failed in 1–8 out of 8 runs, and turning prefetch off did not help. Filter links are now plain anchors, i.e. full document navigations, consistent with the native GET filter form, and they also work without JavaScript. After the change: 16/16 passes.
5. **Clicks lost during hydration.** End-to-end tests now wait for a `data-hydrated` marker before interacting.

# 3D experience gate: Stage 3

| Check | Where it ran | Result |
|---|---|---|
| Typecheck (repo + web), ESLint | native (Node 26.13) | clean |
| Unit tests `pnpm test:web`: procedural models, finish resolution, showroom layout | native | **51 passed** |
| Playwright `pnpm e2e` against a production build, 25 tests incl. 8 new 3D tests | Docker (earlier) and **native, Edge 157 + MySQL 8.0.43** | Docker: 25/25 twice · native: **25/25 twice (59.5 s, 57.1 s)** |
| Database gate `pnpm test:db` | native, MySQL 8.0.43 | **101 passed, 1 todo** |
| Performance `pnpm --filter @furni/web perf` | native, Edge on GPU | see `docs/performance/PERFORMANCE.md` |

New end-to-end coverage (`three.spec.ts`): the viewer renders in 3D, explode/dimensions/reset, finish selection changes the model's variant, keyboard control (E, R), the 2D fallback is user-selectable and persists, the cinematic hero scrubs through all 6 scenes and ends on the live relational cards, reduced motion gets the static hero, showroom room switching and selection, and Studio comparison.

## Defects found while building the gate

1. **Model dimensions.** The chair seat was 92% of the product width and 2.5 cm short of the front, so the model did not match the database. The bounding-box unit tests caught this; every model now matches to within 1 cm.
2. **Finish applied to the wrong part.** "Natural Oak / Sage Fabric" is stored with `material = Oak`, so the sage colour went onto the oak frame. Finish targeting now reads the variant name, with a regression test.
3. **Blank first frame.** A demand-rendered canvas painted before its async environment map was ready and never repainted. Canvases now request frames while they settle.
4. **Out of memory.** Running the e2e suite inside the 3.5 GB Docker VM alongside a polling dev server failed with `ENOMEM`. Fixed by capping Playwright at 2 workers, and since then by moving off Docker entirely.
5. **Eager GSAP.** GSAP and ScrollTrigger (about 48 kB) loaded for every home-page visitor; they now load only for visitors who get the cinematic version.

# Commerce and management gate: Stage 4

* `pnpm test:db`: **121 passed, 1 todo** (adds `commerce.test.ts`: id allocation under concurrency, cart pricing, checkout through the original triggers, declined-payment rollback, stock refusal, concurrent double checkout giving exactly one order, cancellation with stock return, PIN/city 3NF consistency, receipts, reorders, audited price change, offer CHECKs, settlements, supplier scoping, role boundaries).
* e2e `commerce.spec.ts` on an isolated database: **7 passed** (checkout → confirm → ship → deliver with observed trigger effects → review → loyalty; declined payment; audited price change; goods receipt; supplier portal).

Defects found: through the least-privilege user, MySQL reports FK violations as the generic 1216/1217 codes, which the error mapper missed (now mapped); the cart's Remove button collided with the quantity field; staff action forms unmounted after a status change, hiding their effects panel.

# Integrated run: Stages 0–8 (native, MySQL 8.0.43, Edge)

| Suite | Result |
|---|---|
| `pnpm typecheck` (root, web) · `pnpm --filter @furni/web lint` | clean |
| `pnpm test:web` (models, assembly, showroom layout and viewpoints) | **81 passed** |
| `pnpm test:db` (11 files, incl. normalization lab, SQL lab, scenarios, commerce) | **204 passed, 1 todo** |
| `pnpm e2e` (all specs, production build, isolated `furni_e2e_*` schemas) | **43 passed** |

Scope cut at the user's request (not built): ER diagram and views pages (placeholders), Monaco (a textarea is used), the correlated-subquery visualiser, the graph and dashboard trace layers, auto-play, and saving traces to `demo_execution`. Performance was not re-measured after Stage 8 (`/studio` first-load JS is 121 kB, just over the 120 kB budget).
