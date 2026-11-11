"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthError, login, logout } from "@furni/database";
import { db } from "@/lib/server/db";
import { SESSION_COOKIE, safeNext } from "@/lib/server/auth";

export interface SignInState { error?: string; email?: string }

const Credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(160),
  password: z.string().min(1).max(200),
  next: z.string().max(300).optional(),
});

// Simple per-process throttle: 5 failures per email per 10 minutes. (A shared store is needed if several instances run.)
const failures = new Map<string, { count: number; until: number }>();
const WINDOW_MS = 10 * 60_000;

async function isHttps(): Promise<boolean> {
  if (process.env.COOKIE_SECURE) return process.env.COOKIE_SECURE === "true";
  const h = await headers();
  return h.get("x-forwarded-proto") === "https" || (h.get("origin") ?? "").startsWith("https://");
}

export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const parsed = Credentials.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Enter a valid email address and password.", email: String(form.get("email") ?? "") };
  const { email, password, next } = parsed.data;

  const f = failures.get(email);
  if (f && f.count >= 5 && f.until > Date.now()) return { error: "Too many attempts. Try again in a few minutes.", email };

  try {
    const s = await login(db(), email, password);
    failures.delete(email);
    (await cookies()).set(SESSION_COOKIE, s.token, {
      // Secure whenever the site is actually served over HTTPS; a Secure cookie on plain-HTTP localhost would be dropped.
      httpOnly: true, sameSite: "lax", secure: await isHttps(), path: "/",
      expires: new Date(s.expiresAt.replace(" ", "T") + "Z"),
    });
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    const cur = f && f.until > Date.now() ? f : { count: 0, until: Date.now() + WINDOW_MS };
    failures.set(email, { count: cur.count + 1, until: cur.until });
    return { error: "That email and password don't match an account.", email };
  }
  redirect(safeNext(next));
}

/** Server Actions are POST-only and origin-checked by Next.js, which covers CSRF for this form. */
export async function signOut() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await logout(db(), token);
  jar.delete(SESSION_COOKIE);
  redirect("/");
}
