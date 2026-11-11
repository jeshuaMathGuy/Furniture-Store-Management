import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSession, type AuthContext } from "@furni/database";
import { roleHas, type Permission } from "@furni/shared";
import { db } from "./db";

export const SESSION_COOKIE = "furni_session";

/** Current user, resolved once per request from the HttpOnly session cookie. */
export const getSession = cache(async (): Promise<AuthContext | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return resolveSession(db(), token);
});

export async function requireSession(next: string): Promise<AuthContext> {
  const s = await getSession();
  if (!s) redirect(`/login?next=${encodeURIComponent(next)}`);
  return s;
}

export function can(ctx: AuthContext | null, p: Permission): boolean {
  return !!ctx && roleHas(ctx.roles, p);
}

/** Only same-site relative paths are accepted as post-login destinations. */
export function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/account";
}
