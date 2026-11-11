import mysql from "mysql2/promise";
import type { AppDbConfig, DbConfig, LabDbConfig } from "./config.js";

export type Conn = mysql.Connection;
export type Pool = mysql.Pool;

const common = {
  dateStrings: true as const,
  supportBigNumbers: true,
  bigNumberStrings: false,
  timezone: "Z",
  charset: "utf8mb4_0900_ai_ci",
};

export type DbRole = "root" | "app" | "lab_reader" | "lab_operator";

function credentials(cfg: DbConfig, role: DbRole) {
  switch (role) {
    case "root": return { user: "root", password: cfg.MYSQL_ROOT_PASSWORD };
    case "app": return { user: cfg.APP_DB_USER, password: cfg.APP_DB_PASSWORD };
    case "lab_reader": return { user: cfg.LAB_READER_USER, password: cfg.LAB_READER_PASSWORD };
    case "lab_operator": return { user: cfg.LAB_OPERATOR_USER, password: cfg.LAB_OPERATOR_PASSWORD };
  }
}

/** Single dedicated session. Required wherever session state matters (temp tables, transactions, user variables). */
export function connect(cfg: DbConfig, role: DbRole, database?: string): Promise<Conn> {
  return mysql.createConnection({
    ...common,
    ...credentials(cfg, role),
    host: cfg.MYSQL_HOST,
    port: cfg.MYSQL_PORT,
    database,
  });
}

export function createPool(cfg: DbConfig, role: DbRole, database: string, connectionLimit = 10): Pool {
  return mysql.createPool({
    ...common,
    ...credentials(cfg, role),
    host: cfg.MYSQL_HOST,
    port: cfg.MYSQL_PORT,
    database,
    connectionLimit,
    waitForConnections: true,
  });
}

/** Pool for the web server, as the least-privilege application user. */
export function createAppPool(cfg: AppDbConfig, connectionLimit = 10): Pool {
  return mysql.createPool({
    ...common,
    host: cfg.MYSQL_HOST,
    port: cfg.MYSQL_PORT,
    user: cfg.APP_DB_USER,
    password: cfg.APP_DB_PASSWORD,
    database: cfg.APP_DB_NAME,
    connectionLimit,
    waitForConnections: true,
  });
}

/** Pool for the lab sandbox as lab_reader (SELECT only) or lab_operator (scenario DML/EXECUTE, lab schema only). */
export function createLabPool(cfg: LabDbConfig, role: "lab_reader" | "lab_operator", database?: string, connectionLimit = 5): Pool {
  const reader = role === "lab_reader";
  return mysql.createPool({
    ...common,
    host: cfg.MYSQL_HOST,
    port: cfg.MYSQL_PORT,
    user: reader ? cfg.LAB_READER_USER : cfg.LAB_OPERATOR_USER,
    password: reader ? cfg.LAB_READER_PASSWORD : cfg.LAB_OPERATOR_PASSWORD,
    database: database ?? cfg.LAB_DB_NAME,
    connectionLimit,
    waitForConnections: true,
  });
}

/** Run `fn` inside a transaction on a pooled connection, always releasing it. */
export async function withTransaction<T>(pool: Pool, fn: (c: mysql.PoolConnection) => Promise<T>): Promise<T> {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const result = await fn(c);
    await c.commit();
    return result;
  } catch (err) {
    await c.rollback().catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

export function quoteId(name: string): string {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return "`" + name + "`";
}
