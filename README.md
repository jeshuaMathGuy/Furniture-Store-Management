# FURNI / FORM

*Architecture in appearance. Relational integrity underneath.*

**Live demo: https://furni-form.vercel.app**

FURNI / FORM is an immersive furniture showroom, a furniture-store management system and an interactive database laboratory. All three are built on the original `furniture_store_normalized.sql`.

## Requirements

Everything runs natively on Windows

* **Node.js 22 or newer** (developed on 26.13 LTS) and **pnpm 9.15** (`npm install -g pnpm@9.15.0`; Node 25+ no longer ships corepack)
* **MySQL 8.0 or 8.4** running locally (verified on 8.0.43 and 8.4.13)

## Setup

```bash
pnpm install
```

Create `.env` from `.env.example` and put your MySQL root password after `MYSQL_ROOT_PASSWORD=`. The root password is used only by setup, reset and the database tests. Then create `apps/web/.env.local` from `apps/web/.env.example`; it holds only the least-privilege `furni_app` credentials, so the web server never sees root or lab credentials.

Before creating anything, check what already exists on your server (read-only):

```bash
pnpm db:check
```

```bash
pnpm db:setup
```

`db:setup` runs the original script unchanged, captures the normalization snapshots, applies the extension migrations and seeds, rebuilds the lab sandbox, and creates the least-privilege database users. The original script begins with `DROP DATABASE furniture_store_db`, so `db:setup` never re-runs it against an existing application database. To rebuild from scratch:

```bash
pnpm db:reset
```

Reset only the disposable lab sandbox:

```bash
pnpm db:reset-lab
```

## Running and testing

Start the web app at http://localhost:3000:

```bash
pnpm dev
```

Database verification gate (it uses its own `furni_test_*` schemas and leaves your data alone):

```bash
pnpm test:db
```

Typecheck, lint and unit tests (procedural models, showroom layout):

```bash
pnpm typecheck
```

```bash
pnpm --filter @furni/web lint
```

```bash
pnpm test:web
```

End-to-end tests. These build for production, start a server on port 3100, and run Playwright in the Microsoft Edge that ships with Windows, so no browser download is needed (set `PW_CHANNEL=chromium` to use Playwright's own Chromium instead):

```bash
pnpm e2e
```

Performance measurements (start the production server first with `pnpm --filter @furni/web build` and `pnpm --filter @furni/web start`):

```bash
pnpm --filter @furni/web perf
```

The application database is `furni_form_app`. The original script's own `furniture_store_db` is never created, dropped or modified by setup, so an existing copy on your server is left alone.

`docker-compose.yml` is kept only for reference and is no longer used or required.

## Layout

| Path | Contents |
|---|---|
| `database/original/` | the authoritative source SQL, byte-identical (SHA-256 checked) |
| `database/migrations/` | additive extension migrations (`-- targets: app, lab`) |
| `database/seeds/` | reference data and a provenance-tagged demo catalog |
| `database/snapshots/` | generated: baseline execution report and the 34 teaching relations as JSON |
| `database/tests/` | MySQL integration tests (Vitest) |
| `apps/web/` | Next.js 15 App Router site: design tokens, storefront, sign-in, account, Playwright tests |
| `packages/database/` | runner, `DELIMITER`-aware splitter, typed repositories, auth/RBAC, snapshot diff |
| `packages/shared/` | roles/permission matrix and execution-trace types |
| `docs/` | architecture, source audit, roles and accounts, test results |

Screenshot of the Website

<img width="1895" height="911" alt="image" src="https://github.com/user-attachments/assets/c37e3713-3798-4e37-93f0-e40d2bf9aee7" />

