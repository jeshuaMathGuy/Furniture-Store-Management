import { loadConfig } from "./config.js";
import { rebuildLab, setupAll } from "./setup.js";

const [, , command, ...args] = process.argv;
const log = (m: string) => console.log(`[db] ${m}`);

try {
  let cfg: ReturnType<typeof loadConfig>;
  try { cfg = loadConfig(); } catch (e) {
    const issues = (e as { issues?: { path: string[]; message: string }[] }).issues;
    throw new Error(issues ? issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : (e as Error).message);
  }
  if (command === "check") {
    // Read-only: report server version and which FURNI / FORM schemas already exist.
    const { connect } = await import("./connection.js");
    const c = await connect(cfg, "root");
    const [[v]] = await c.query("SELECT VERSION() AS v") as unknown as [[{ v: string }]];
    const names = [cfg.APP_DB_NAME, cfg.LAB_DB_NAME, cfg.TEACHING_DB_NAME, "furni_test_app", "furni_test_lab", "furni_test_teaching", "furniture_store_db"];
    const [rows] = await c.query("SELECT SCHEMA_NAME AS s FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (?)", [names]) as unknown as [{ s: string }[]];
    const existing = new Set(rows.map((r) => r.s));
    log(`MySQL ${v.v} at ${cfg.MYSQL_HOST}:${cfg.MYSQL_PORT}`);
    for (const n of names) {
      let detail = "";
      if (existing.has(n)) {
        // App and lab schemas carry schema_migration; teaching snapshots carry the base_* checkpoint tables.
        const [[t]] = await c.query("SELECT COUNT(*) AS n, SUM(TABLE_NAME IN ('schema_migration', 'base_product')) AS managed FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [n]) as unknown as [[{ n: number; managed: string | null }]];
        detail = ` (${t.n} tables${Number(t.managed) ? ", created by FURNI / FORM setup" : ", NOT created by FURNI / FORM setup"})`;
      }
      log(`${existing.has(n) ? "EXISTS " : "absent "} ${n}${detail}`);
    }
    await c.end();
  } else if (command === "setup") {
    await setupAll(cfg, { reset: args.includes("--reset"), writeArtifacts: true, log });
  } else if (command === "reset-lab") {
    await rebuildLab(cfg);
    log(`Lab sandbox ${cfg.LAB_DB_NAME} rebuilt from the original script`);
  } else {
    console.error("usage: cli.ts check | setup [--reset] | reset-lab");
    process.exitCode = 2;
  }
} catch (err) {
  console.error(`[db] FAILED: ${(err as Error).message}`);
  process.exitCode = 1;
}
