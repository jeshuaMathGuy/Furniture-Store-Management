import { createHash, randomBytes } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { ROLES, type Role } from "@furni/shared";
import type { Pool } from "../connection.js";
import { verifyPassword } from "./password.js";
import type { AuthContext } from "./authorize.js";

const SESSION_TTL_HOURS = 24 * 7;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export class AuthError extends Error {
  constructor(message = "Invalid credentials") { super(message); this.name = "AuthError"; }
}

export interface IssuedSession { token: string; csrfToken: string; expiresAt: string; context: AuthContext }

/** Verify credentials and issue a session. Uniform error for unknown user vs bad password. */
export async function login(pool: Pool, email: string, password: string): Promise<IssuedSession> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT user_id, password_hash, is_active FROM app_user WHERE email = ?", [email.trim().toLowerCase()]);
  const user = rows[0];
  // Hash even when the user is missing, to keep timing similar.
  const ok = await verifyPassword(password, user?.password_hash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  if (!user || !ok || !user.is_active) throw new AuthError();
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_TTL_HOURS * 3600_000);
  const expiresAt = expires.toISOString().slice(0, 19).replace("T", " ");
  await pool.query("INSERT INTO app_session (session_hash, user_id, csrf_token, expires_at) VALUES (?,?,?,?)",
    [sha256(token), user.user_id, csrfToken, expiresAt]);
  return { token, csrfToken, expiresAt, context: await loadContext(pool, user.user_id as number) };
}

export async function resolveSession(pool: Pool, token: string | undefined): Promise<AuthContext | null> {
  if (!token) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.user_id FROM app_session s JOIN app_user u ON u.user_id = s.user_id
      WHERE s.session_hash = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP() AND u.is_active`,
    [sha256(token)]);
  return rows[0] ? loadContext(pool, rows[0].user_id as number) : null;
}

export async function verifyCsrf(pool: Pool, token: string, csrf: string | undefined): Promise<boolean> {
  if (!csrf) return false;
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT csrf_token FROM app_session WHERE session_hash = ? AND revoked_at IS NULL", [sha256(token)]);
  return rows[0]?.csrf_token === csrf;
}

export async function logout(pool: Pool, token: string): Promise<void> {
  await pool.query("UPDATE app_session SET revoked_at = UTC_TIMESTAMP() WHERE session_hash = ?", [sha256(token)]);
}

export async function loadContext(pool: Pool, userId: number): Promise<AuthContext> {
  const [[u], [roles], [cust], [supp]] = await Promise.all([
    pool.query<RowDataPacket[]>("SELECT user_id, email, display_name FROM app_user WHERE user_id = ?", [userId]),
    pool.query<RowDataPacket[]>("SELECT role_code FROM app_user_role WHERE user_id = ?", [userId]),
    pool.query<RowDataPacket[]>("SELECT customer_id FROM customer_user_mapping WHERE user_id = ?", [userId]),
    pool.query<RowDataPacket[]>("SELECT supplier_id FROM supplier_user_mapping WHERE user_id = ?", [userId]),
  ]);
  if (!u[0]) throw new AuthError("User not found");
  return {
    userId,
    email: u[0].email,
    displayName: u[0].display_name,
    roles: roles.map((r) => r.role_code as string).filter((r): r is Role => (ROLES as readonly string[]).includes(r)),
    customerId: (cust[0]?.customer_id as number | undefined) ?? null,
    supplierIds: supp.map((s) => s.supplier_id as number),
  };
}
