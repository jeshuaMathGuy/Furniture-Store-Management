# Roles, permissions and demo accounts

Permissions are enforced on the server in `packages/database/src/auth/authorize.ts`. The repositories also apply data scope: a customer is limited to their own `customer_id`, and a supplier to their own `supplier_id`s. The single source of the matrix is `packages/shared/src/roles.ts`.

| Permission | Customer | Admin | Warehouse | Supplier | Student |
|---|:-:|:-:|:-:|:-:|:-:|
| catalog:read | ✔ | ✔ | ✔ | ✔ | ✔ |
| cart / own orders / own feedback / own loyalty | ✔ | | | | |
| order:any:read | | ✔ | ✔ | | |
| order:any:transition | | ✔ | | | |
| order:confirm (`sp_confirm_order`) | | ✔ | ✔ | | |
| product, offer, customer, supplier management | | ✔ | | | |
| inventory:read / receive (`sp_receive_goods`) / reorders | | ✔ | ✔ | | |
| settlement:manage | | ✔ | | | |
| supplier:own:read, settlement:own:read | | | | ✔ | |
| lab:read / lab:scenario:run / lab:reset | | ✔ | | | ✔ |

## Demo accounts (local development only)

Every account below uses the password in `DEMO_ACCOUNT_PASSWORD` from `.env`; `.env.example` holds the default. These accounts exist only in your local MySQL server. Never reuse that password anywhere else.

| Email | Role | Linked to |
|---|---|---|
| admin@furniform.local | administrator | – |
| warehouse@furniform.local | warehouse | – |
| cedarworks@furniform.local | supplier | supplier 10 |
| urbannest@furniform.local | supplier | supplier 20 |
| student@furniform.local | student | – |
| instructor@furniform.local | student + administrator | – |
| asha.rao@example.com | customer | customer 1 (original data) |
| dev.shah@example.com | customer | customer 2 (original data) |
| mira.nair@example.com | customer | customer 3 (original data) |

## Database users

| User | Privileges |
|---|---|
| `furni_app` | DML and EXECUTE on the application database (`furni_form_app`) only; no DDL |
| `lab_reader` | SELECT on the lab and teaching schemas; EXECUTE on the two functions only |
| `lab_operator` | DML and EXECUTE on the lab schema only; used only by server-defined scenarios |

Tests check each of these boundaries (`database/tests/sandbox.test.ts`).
