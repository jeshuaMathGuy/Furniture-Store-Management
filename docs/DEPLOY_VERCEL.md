# Deploying to Vercel

Vercel hosts the Next.js site only. The site needs a **MySQL 8 server reachable from the internet**, because Vercel cannot reach the MySQL on your PC.

## 1. Create a hosted MySQL 8 database

It must support stored procedures, triggers and functions, multiple databases, and `CREATE USER`/`GRANT` (you need the admin/root user).

| Provider | Works? |
|---|---|
| **Railway** (MySQL template) | Yes: full MySQL 8, root user. Use the **public TCP proxy** host and port (`*.proxy.rlwy.net`, from `MYSQL_PUBLIC_URL`), not `mysql.railway.internal`; that connection is unencrypted, so keep `MYSQL_SSL=false` |
| **Aiven for MySQL** | Yes: TLS required (`MYSQL_SSL=true`); set `log_bin_trust_function_creators=1` in the service's advanced config |
| PlanetScale, TiDB Cloud | **No**: stored procedures and triggers are not supported properly |

Note the host, port, admin user (`root` or `avnadmin`) and password.

## 2. Load the database from your PC (once)

Back up your local `.env` (copy it, for example to `.env.local-backup`), then point `.env` at the hosted server:

```
MYSQL_HOST=<hosted host>
MYSQL_PORT=<hosted port>
MYSQL_ROOT_USER=<admin user>    # root on Railway, avnadmin on Aiven
MYSQL_ROOT_PASSWORD=<hosted admin password>
MYSQL_SSL=true                # if the provider requires TLS (Aiven: yes)
```

Choose your own strong passwords for `APP_DB_PASSWORD`, `LAB_READER_PASSWORD` and `LAB_OPERATOR_PASSWORD`. They become the passwords of the MySQL users that setup creates. Then run:

```bash
pnpm db:check
```

```bash
pnpm db:setup
```

This creates `furni_form_app`, `furniture_lab_db`, `furniture_lab_db_fixture` and `furniture_teaching`, plus the users `furni_app`, `lab_reader` and `lab_operator`. If it fails creating functions or triggers with a "SUPER privilege / binary logging" error, set `log_bin_trust_function_creators=1` on the server and run it again.

Afterwards, restore your local `.env` from the backup.

## 3. Create the Vercel project

1. Vercel → **Add New → Project** → import `jeshuaMathGuy/Furniture-Store-Management`.
2. **Root Directory:** `apps/web`. Leave "Include files outside the root directory" **on**, because the app uses `packages/*`.
3. Framework preset: **Next.js** (detected). Vercel detects pnpm from `pnpm-lock.yaml`, so leave the install and build commands as they are.
4. **Settings → General → Node.js Version:** `22.x`.
5. **Environment Variables** (Production and Preview):

| Name | Value |
|---|---|
| `MYSQL_HOST` / `MYSQL_PORT` | the hosted server |
| `MYSQL_SSL` | `true` if TLS is required |
| `MYSQL_SSL_CA` | only if the provider gives a CA certificate (Aiven): paste the PEM; `\n` escapes are accepted |
| `APP_DB_NAME` | `furni_form_app` |
| `APP_DB_USER` / `APP_DB_PASSWORD` | `furni_app` / the password you chose |
| `LAB_DB_NAME` / `TEACHING_DB_NAME` | `furniture_lab_db` / `furniture_teaching` |
| `LAB_READER_USER` / `LAB_READER_PASSWORD` | `lab_reader` / your password |
| `LAB_OPERATOR_USER` / `LAB_OPERATOR_PASSWORD` | `lab_operator` / your password |
| `DEMO_AS_OF` (optional) | pin the "today" date for offers, e.g. `2026-11-10` |

**Never add `MYSQL_ROOT_PASSWORD` to Vercel.** The site does not need it.

6. **Settings → Functions → Region:** choose the region closest to your database (every page queries it).
7. Deploy.

## 4. Check

* `/collection` lists 20 pieces, so the app user works.
* Sign in as `student@furniform.local` (password = `DEMO_ACCOUNT_PASSWORD` used at setup) and open `/lab/sql`. A query runs, so the lab reader works.
* `/lab/procedures` runs a scenario, so the lab operator works.

## Behaviour on Vercel

* Database pools shrink to 3 connections per instance on Vercel (`DB_POOL_SIZE` overrides). The MySQL users are capped at 50, 10 and 5 connections server-wide.
* Session cookies are `Secure` automatically (HTTPS).
* The sign-in throttle is per instance, so it is weaker on serverless. Acceptable for a demo.
* The demo accounts' password is public in the repository (`.env.example`). For a public deployment, set a different `DEMO_ACCOUNT_PASSWORD` in `.env` before running `db:setup`.
