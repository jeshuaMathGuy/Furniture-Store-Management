import "server-only";
import { createAppPool, loadAppConfig, type Pool } from "@furni/database";

const g = globalThis as unknown as { __furniPool?: Pool };

/** One pool per server process (survives dev hot reloads). Uses the least-privilege furni_app user. */
export function db(): Pool {
  g.__furniPool ??= createAppPool(loadAppConfig());
  return g.__furniPool;
}

/**
 * Storefront "today" for offer evaluation. DEMO_AS_OF pins it for reproducible
 * demonstrations and tests; otherwise the real UTC date is used.
 */
export function asOfDate(): string {
  const pinned = process.env.DEMO_AS_OF;
  if (pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned)) return pinned;
  return new Date().toISOString().slice(0, 10);
}
