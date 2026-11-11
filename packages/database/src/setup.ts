import { join } from "node:path";
import type { RowDataPacket } from "mysql2";
import type { DbConfig } from "./config.js";
import { connect, quoteId, type Conn } from "./connection.js";
import { hashPassword } from "./auth/password.js";
import { captureLabFixture, labFixtureDbName } from "./lab/fixture.js";
import {
  ORIGINAL_ROUTINES, REPO_ROOT, applyMigrations, exportSchemaTables, runOriginal, runSqlFile, writeJson,
  type StatementReport,
} from "./runner.js";

export interface SetupOptions {
  reset?: boolean;
  /** Write baseline report + teaching JSON into database/snapshots (default build only). */
  writeArtifacts?: boolean;
  log?: (msg: string) => void;
}

async function schemaExists(conn: Conn, name: string): Promise<boolean> {
  const [rows] = await conn.query<RowDataPacket[]>("SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?", [name]);
  return rows.length > 0;
}

/** Full setup: application DB, teaching snapshots, lab sandbox, users and grants. */
export async function setupAll(cfg: DbConfig, opts: SetupOptions = {}) {
  const log = opts.log ?? (() => undefined);
  const root = await connect(cfg, "root");
  let baseline: StatementReport[] | null = null;
  try {
    const exists = await schemaExists(root, cfg.APP_DB_NAME);
    if (exists && !opts.reset) {
      log(`${cfg.APP_DB_NAME} exists: baseline NOT re-run (it drops the database). Use --reset to rebuild.`);
    } else {
      log(`Executing original SQL into ${cfg.APP_DB_NAME}`);
      baseline = await runOriginal(cfg, { dbName: cfg.APP_DB_NAME });
    }
  } finally {
    await root.end();
  }

  const applied = await applyMigrations(cfg, cfg.APP_DB_NAME, "app");
  log(`App migrations applied: ${applied.join(", ") || "(none pending)"}`);
  await runSqlFile(cfg, cfg.APP_DB_NAME, join(REPO_ROOT, "database/seeds/0001_reference.sql"));
  await runSqlFile(cfg, cfg.APP_DB_NAME, join(REPO_ROOT, "database/seeds/0002_demo_catalog.sql"));
  await runSqlFile(cfg, cfg.APP_DB_NAME, join(REPO_ROOT, "database/seeds/0003_demo_addresses.sql"));
  await seedDemoAccounts(cfg);
  log("Seeds applied");

  await rebuildLab(cfg, { captureTeaching: true });
  log(`Lab sandbox ${cfg.LAB_DB_NAME} and teaching snapshots ${cfg.TEACHING_DB_NAME} rebuilt`);

  await ensureDbUsers(cfg);
  log("Database users and grants ensured");

  if (opts.writeArtifacts) {
    if (baseline) writeJson("database/snapshots/baseline-report.json", { source: "database/original/furniture_store_normalized.sql", statements: baseline });
    const tables = await exportSchemaTables(cfg, cfg.TEACHING_DB_NAME, "database/snapshots/teaching");
    log(`Exported ${tables.length} teaching snapshot tables to database/snapshots/teaching`);
  }
  return { baseline };
}

/** Drop and rebuild the disposable sandbox from the original script + lab-targeted migrations. */
export async function rebuildLab(cfg: DbConfig, opts: { captureTeaching?: boolean } = {}) {
  await runOriginal(cfg, { dbName: cfg.LAB_DB_NAME, teachingDb: opts.captureTeaching ? cfg.TEACHING_DB_NAME : undefined });
  await applyMigrations(cfg, cfg.LAB_DB_NAME, "lab");
  // Copy of the freshly built sandbox, so the web server can reset it with lab_operator DML only (no root).
  await captureLabFixture(cfg);
  await ensureDbUsers(cfg);
}

/**
 * Least-privilege users. lab_* users have no grant at all on the application DB.
 * Procedures are SQL SECURITY DEFINER, so lab_reader gets EXECUTE on the two
 * NO SQL functions only: EXECUTE on a procedure would let it mutate data.
 */
export async function ensureDbUsers(cfg: DbConfig) {
  const c = await connect(cfg, "root");
  const app = quoteId(cfg.APP_DB_NAME), lab = quoteId(cfg.LAB_DB_NAME), teach = quoteId(cfg.TEACHING_DB_NAME);
  const users: [string, string, string][] = [
    [cfg.APP_DB_USER, cfg.APP_DB_PASSWORD, "MAX_USER_CONNECTIONS 50"],
    [cfg.LAB_READER_USER, cfg.LAB_READER_PASSWORD, "MAX_USER_CONNECTIONS 10"],
    [cfg.LAB_OPERATOR_USER, cfg.LAB_OPERATOR_PASSWORD, "MAX_USER_CONNECTIONS 5"],
  ];
  try {
    for (const [u, pw, limits] of users) {
      await c.query(`CREATE USER IF NOT EXISTS ?@'%' IDENTIFIED BY ?`, [u, pw]);
      await c.query(`ALTER USER ?@'%' IDENTIFIED BY ? WITH ${limits}`, [u, pw]);
    }
    await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON ${app}.* TO ?@'%'`, [cfg.APP_DB_USER]);
    await c.query(`GRANT SELECT ON ${lab}.* TO ?@'%'`, [cfg.LAB_READER_USER]);
    await c.query(`GRANT SELECT ON ${teach}.* TO ?@'%'`, [cfg.LAB_READER_USER]);
    await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${lab}.* TO ?@'%'`, [cfg.LAB_OPERATOR_USER]);
    await c.query(`GRANT SELECT ON ${teach}.* TO ?@'%'`, [cfg.LAB_OPERATOR_USER]);
    for (const fn of ORIGINAL_ROUTINES.FUNCTION) {
      for (const u of [cfg.LAB_READER_USER, cfg.LAB_OPERATOR_USER])
        await c.query(`GRANT EXECUTE ON FUNCTION ${lab}.${quoteId(fn)} TO ?@'%'`, [u]);
    }
    for (const sp of ORIGINAL_ROUTINES.PROCEDURE)
      await c.query(`GRANT EXECUTE ON PROCEDURE ${lab}.${quoteId(sp)} TO ?@'%'`, [cfg.LAB_OPERATOR_USER]);
    // Lab fixture (Stage 6): read-only copy used for the root-less sandbox reset and for object metadata
    // (trigger/procedure bodies) that lab users cannot see in information_schema. SHOW VIEW lets the
    // read-only playground EXPLAIN queries over the vw_* views. Nothing here touches the application DB.
    const fixture = quoteId(labFixtureDbName(cfg.LAB_DB_NAME));
    await c.query(`GRANT SELECT ON ${fixture}.* TO ?@'%'`, [cfg.LAB_READER_USER]);
    await c.query(`GRANT SELECT ON ${fixture}.* TO ?@'%'`, [cfg.LAB_OPERATOR_USER]);
    await c.query(`GRANT SHOW VIEW ON ${lab}.* TO ?@'%'`, [cfg.LAB_READER_USER]);
  } finally {
    await c.end();
  }
}

export const DEMO_ACCOUNTS = [
  { email: "admin@furniform.local", name: "Studio Administrator", roles: ["administrator"] },
  { email: "warehouse@furniform.local", name: "Warehouse Operator", roles: ["warehouse"] },
  { email: "cedarworks@furniform.local", name: "CedarWorks (supplier)", roles: ["supplier"], supplierId: 10 },
  { email: "urbannest@furniform.local", name: "UrbanNest (supplier)", roles: ["supplier"], supplierId: 20 },
  { email: "student@furniform.local", name: "Database Student", roles: ["student"] },
  { email: "instructor@furniform.local", name: "Instructor", roles: ["student", "administrator"] },
  // Customer logins map onto the three original customers (emails from the source SQL).
  { email: "asha.rao@example.com", name: "Asha Rao", roles: ["customer"], customerId: 1 },
  { email: "dev.shah@example.com", name: "Dev Shah", roles: ["customer"], customerId: 2 },
  { email: "mira.nair@example.com", name: "Mira Nair", roles: ["customer"], customerId: 3 },
] as const;

export async function seedDemoAccounts(cfg: DbConfig) {
  const c = await connect(cfg, "root", cfg.APP_DB_NAME);
  try {
    for (const a of DEMO_ACCOUNTS) {
      const [existing] = await c.query<RowDataPacket[]>("SELECT user_id FROM app_user WHERE email=?", [a.email]);
      let userId = existing[0]?.user_id as number | undefined;
      if (!userId) {
        const [res] = await c.query<import("mysql2").ResultSetHeader>(
          "INSERT INTO app_user (email, display_name, password_hash, is_demo) VALUES (?,?,?,TRUE)",
          [a.email, a.name, await hashPassword(cfg.DEMO_ACCOUNT_PASSWORD)]);
        userId = res.insertId;
      }
      for (const r of a.roles) await c.query("INSERT IGNORE INTO app_user_role (user_id, role_code) VALUES (?,?)", [userId, r]);
      if ("customerId" in a) await c.query("INSERT IGNORE INTO customer_user_mapping (user_id, customer_id) VALUES (?,?)", [userId, a.customerId]);
      if ("supplierId" in a) await c.query("INSERT IGNORE INTO supplier_user_mapping (user_id, supplier_id) VALUES (?,?)", [userId, a.supplierId]);
    }
  } finally {
    await c.end();
  }
}
