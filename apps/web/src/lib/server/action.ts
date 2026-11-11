import "server-only";
import { ZodError } from "zod";
import { AuthError, DomainError, ForbiddenError, observeEffects, type ObservedEffects } from "@furni/database";
import { db } from "./db";

export interface ActionResult {
  ok: boolean;
  message?: string;
  error?: string;
  effects?: ObservedEffects;
  /** Echo of submitted values so forms can keep them after an error. */
  values?: Record<string, string>;
}

export const idle: ActionResult = { ok: false };

function describe(e: unknown): string {
  if (e instanceof ZodError) return e.issues.map((i) => i.message).join("; ");
  if (e instanceof DomainError || e instanceof ForbiddenError || e instanceof AuthError) return e.message;
  console.error(e);
  return "Something went wrong. The change was not saved.";
}

/**
 * Run a mutation for a Server Action. Known errors (validation, permission,
 * trigger or constraint rejections) become messages; with `observe`, the
 * audit_log and order_status_history rows written meanwhile are returned so the
 * UI can show the trigger effects.
 */
export async function runAction(fn: () => Promise<string | void>, opts: { observe?: boolean; values?: Record<string, string> } = {}): Promise<ActionResult> {
  try {
    if (opts.observe) {
      const { result, effects } = await observeEffects(db(), fn);
      return { ok: true, message: result || "Done.", effects };
    }
    return { ok: true, message: (await fn()) || "Done." };
  } catch (e) {
    return { ok: false, error: describe(e), values: opts.values };
  }
}

export const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
export const num = (f: FormData, k: string) => Number(f.get(k));
