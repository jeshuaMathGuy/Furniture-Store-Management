# FURNI / FORM: architecture

*Architecture in appearance. Relational integrity underneath.*

## 1. System overview

```
┌──────────────────────────── Browser ─────────────────────────────┐
│ Next.js App Router (RSC + client islands)                        │
│  Storefront ─ Showroom (R3F) ─ Studio ─ Database Lab ─ Mgmt      │
│  No credentials, no SQL strings: typed fetch / server actions    │
└───────────────┬──────────────────────────────────────────────────┘
                │ HTTPS · session cookie (HttpOnly, SameSite=Lax) · CSRF token on mutations
┌───────────────▼────────────── apps/web (server) ──────────────────┐
│ Route handlers / server actions → Zod validation → authorize()   │
│ Services (catalog, checkout, inventory, lab-orchestrator, trace) │
└──────┬───────────────────────┬──────────────────────┬────────────┘
       │ furni_app (DML+EXEC)  │ lab_reader (SELECT)  │ lab_operator (scenario-only)
┌──────▼─────────┐   ┌─────────▼─────────┐   ┌────────▼─────────────┐
│ furniture_     │   │ furniture_lab_db  │   │ furniture_teaching   │
│ store_db (app) │   │ disposable replay │   │ immutable snapshots  │
└────────────────┘   └───────────────────┘   └──────────────────────┘
                    one local MySQL server (verified on 8.0.43 and 8.4.13)
```

The three schemas are separated by privileges, not by convention. The `lab_*` users have **no** grant on the application database. Setup, reset and the database tests use root; the root password lives only in the repository `.env`, which the web server never reads (it gets `apps/web/.env.local` with the `furni_app` credentials only).

The application database is named **`furni_form_app`**, not `furniture_store_db`. The original script drops and recreates `furniture_store_db`, and a developer's MySQL may already hold their own run of that script. The runner retargets the script to `furni_form_app` in memory, so an existing `furniture_store_db` is never touched.

## 2. Technology decisions (compatibility matrix)

| Concern | Choice | Reason |
|---|---|---|
| Runtime | Native Node.js (22+, developed on 26.13 LTS) + pnpm 9.15 | Docker was dropped at the user's request: the 3.5 GB Docker VM ran out of memory under software-WebGL e2e runs, and bind-mount polling made the dev server slow. Native runs are ~2.5× faster. |
| Browser for e2e / perf | Microsoft Edge (Playwright `channel: "msedge"`) | Ships with Windows, so no browser download is needed; it renders on the real GPU (Direct3D 11 through ANGLE). Override with `PW_CHANNEL`. |
| Package manager | pnpm 9 (corepack) workspaces | Strict dependency isolation for a monorepo |
| DB | MySQL **8.4 LTS** | The source script runs unchanged on it (only warning 1287, see audit F14) |
| Driver | `mysql2` 3.x (promise API) | Native procedures, OUT params via session variables, multiple result sets |
| Validation | Zod 3 | Shared between API and forms |
| Tests | Vitest 2, Playwright (Stage 2+) | |
| Web | Next.js 15 (App Router) + React 19 | R3F 9 requires React 19; R3F 8 is incompatible with React 19 |
| 3D | three r17x · @react-three/fiber 9 · @react-three/drei 10 | Matched majors for React 19 |
| Motion | GSAP 3 + ScrollTrigger (cinematic scroll), Motion 12 (UI) | GSAP is free for all uses since 3.13 |
| Graph | @xyflow/react 12 + elkjs layout | Maintained successor of React Flow |
| SQL editor | @monaco-editor/react 4 | |
| Tables / state | TanStack Table 8, TanStack Query 5 | |
| ORM | **None.** Hand-written, typed repositories over `mysql2`. | The original schema stays authoritative and nothing reinterprets it. |

Exact versions are pinned in each `package.json` when the package is added (Stage 1: database packages only).

## 3. Repository layout

```
database/
  original/        byte-identical source SQL (+ hash check)
  migrations/      0002+ additive extension migrations
  seeds/           demo catalog (provenance-tagged)
  snapshots/       generated: baseline-report.json, teaching snapshots (JSON)
  queries/         lab query library (Stage 6)
  tests/           Vitest MySQL integration tests (database gate)
packages/
  database/        pool, splitter, runner, repositories, auth, CLI
  shared/          roles, permission matrix, Zod schemas, trace types
apps/web/          Next.js (Stage 2)
docs/              architecture, database, normalization, api, demonstrations
docker-compose.yml   optional, unused (kept for reference)
```

## 4. Database users and privileges

| User | Grants | Used by |
|---|---|---|
| `root` | all | migrator only (setup / reset) |
| `furni_app` | SELECT/INSERT/UPDATE/DELETE on `furni_form_app.*`, EXECUTE on its routines; **no DDL** | web server |
| `lab_reader` | SELECT on `furniture_lab_db.*` and `furniture_teaching.*`, EXECUTE on the **two functions only**; `MAX_USER_CONNECTIONS 10` | SQL playground (read-only mode) |
| `lab_operator` | SELECT/INSERT/UPDATE/DELETE on `furniture_lab_db.*`, EXECUTE on its procedures | server-defined scenarios only, never free-form SQL |

Procedures are `SQL SECURITY DEFINER`. That is why `lab_reader` must not receive procedure EXECUTE: a single `CALL` would mutate data. The SQL playground also enforces `MAX_EXECUTION_TIME` and row limits, opens a read-only transaction, and classifies statements with a real parser (Stage 6). Classification is defence in depth. The privilege boundary is the security boundary.

## 5. Application extension model (migration 0002+)

The original tables are central. Every new table references them and none replaces them.

| Table | Purpose | Key relationships |
|---|---|---|
| `data_provenance` | marks each seeded row as `original_sql` / `demo_seed` | (entity_name, entity_key) |
| `app_role`, `app_user`, `app_user_role` | identity and RBAC (scrypt hashes) | |
| `app_session` | server-side sessions (SHA-256 of token stored) | → app_user |
| `customer_user_mapping` / `supplier_user_mapping` | link logins to business entities | → customer / supplier |
| `product_category`, `product_detail` | category, room, materials, dimensions | product_detail.product_id → product (1:1) |
| `product_media` | images and GLB models | → product |
| `product_variant`, `product_variant_inventory` | finish/fabric variants and their stock | → product |
| `cart`, `cart_item` | baskets | → app_user, product, variant |
| `shipping_address` | | → customer, postal_area |
| `order_line_configuration` | variant plus configuration snapshot for an `order_line` | → order_line (order_id, product_id) |
| `payment_record` | **simulated** payments (no card data columns exist) | → sales_order |
| `shipment` | fulfilment | → sales_order |
| `demo_scenario`, `demo_execution`, `demo_execution_step` | lab traces | |

Constraint carried over from the original schema: `order_line` has PK `(order_id, product_id)`, so one order can hold **one variant per product**. The cart enforces this rule and does not work around it.

Checkout path, which respects source finding F4 (lines can only be added to a draft order):

```
INSERT sales_order(draft) → INSERT order_line(s) (+configuration) → payment_record(simulated)
→ UPDATE status='placed'  (bu/au triggers fire: history + audit)
→ later: CALL sp_confirm_order (stock deduction) by admin/warehouse
```

## 6. Execution traces (Stage 7 contract, types defined in Stage 1)

The server is the only source of a trace. For each step it captures a `TableSnapshot` before and after, and computes a `RowChange[]` diff keyed by primary key. It also reads new `audit_log` and `order_status_history` rows, which is how trigger effects are observed. The status is set from what the database reports: `committed`, `rolled_back` or `failed`. Because the procedures commit internally (F3), snapshots are taken outside the procedure call, and a failed call is checked to confirm the rollback.

## 7. Design system (summary)

| Token | Value | Role |
|---|---|---|
| `porcelain` | #F5F1E9 | page background |
| `oat` | #D9C7B5 | surfaces, dividers |
| `sage` | #A8B09D | success, "added" rows |
| `clay` | #B77D63 | primary action, "updated" rows |
| `charcoal` | #373A34 | text, dark surfaces |
| `walnut` | #6B4E3D | accents |
| `brass` | #B08D57 | focus ring, highlights |

* **Type:** editorial serif (Cormorant Garamond or Fraunces) for display headings. Inter for UI, forms and data. JetBrains Mono for SQL.
* **Row diff colours:** added uses sage, updated uses clay, removed uses charcoal with strike-through. Each state also has a text badge, so colour is never the only signal.
* **Motion:** 200–320 ms ease-out for UI, and scroll-scrubbed timelines for the cinematic sections. Under `prefers-reduced-motion` every timeline jumps to its end state. The 3D canvas uses `frameloop="demand"` outside active scenes.

### Page architecture

```
/                 Discover (cinematic hero: 6 scroll scenes)
/collection       catalog + filters        /collection/[id]  product + FurnitureViewer
/showroom/[room]  curated-camera rooms     /studio           configurator + compare
/lab              lab hub: /lab/normalization, /lab/sql, /lab/schema,
                  /lab/procedures, /lab/triggers, /lab/transactions, /lab/integrity
/manage           role dashboards: orders, inventory, suppliers, offers, settlements
/account          auth, orders, reviews, loyalty
```

### Component hierarchy (key)

`AppShell` › `GlobalNav` (role-aware) › route. Shared: `DataGrid` (TanStack), `DiffGrid`, `TraceTimeline`, `SchemaGraph`, `ProofPanel`, `FurnitureViewer` (lazy, with a `<img>` fallback), `SceneCanvas` (demand frameloop, DPR clamp).

## 8. Staged plan and acceptance gates

| Stage | Delivers | Gate (automated unless noted) |
|---|---|---|
| **0** | audit, inventory, architecture | docs reviewed ✔ |
| **1** | Compose, runner, baseline, teaching snapshots, lab DB, extension migrations, seeds, users/grants, repositories, auth/RBAC | `pnpm test:db`: baseline values, object inventory, invariance of original objects, 5 procs, 5 triggers, 2 functions, rollback, F1 race and mitigation, sandbox isolation, reset determinism, authorization |
| 2 | Next.js shell, tokens, nav, catalog (2D), auth pages | typecheck, lint, Playwright nav/filter smoke |
| 3 | hero scene, FurnitureViewer, materials | Lighthouse budget, reduced-motion e2e |
| 4 | cart, checkout (simulated), order history, management dashboards | e2e checkout → DB rows asserted |
| 5 | normalization lab UNF→4NF | snapshot reconstruction tests, step-control e2e |
| 6 | SQL lab, procedure/trigger/function labs, views, transactions, concurrency | sandbox isolation e2e, scenario tests |
| 7 | unified traces + 4 synced layers + playback | trace vs observed-state tests |
| 8 | showroom rooms, exploded view, recommender, a11y | axe checks, perf budget |
| 9 | full suite, rehearsal, docs | clean-checkout rebuild |

**Feasibility priorities:** the minimum vertical slice is Stage 1, then a 2D catalog (Stage 2), then checkout (Stage 4), then one normalization stage and one procedure trace. 3D polish follows that. The 3D models are procedural, built from primitives with segmented parts, until licensed GLB assets are added. They are not labelled as physically accurate assemblies.
