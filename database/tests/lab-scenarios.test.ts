import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, createPool, type Conn, type Pool } from "../../packages/database/src/connection.js";
import { ORIGINAL_TABLES } from "../../packages/database/src/runner.js";
import { labFixtureDbName } from "../../packages/database/src/lab/fixture.js";
import { resetSandbox, runScenarioDef, type LabDeps } from "../../packages/database/src/lab/scenario-runner.js";
import { SCENARIOS } from "../../packages/database/src/lab/scenarios.js";
import { validateTrace } from "../../packages/database/src/lab/trace.js";
import { fingerprint, q, testCfg } from "./helpers.js";

const cfg = testCfg();
let operator: Pool, root: Conn, deps: LabDeps;
beforeAll(async () => {
  operator = createPool(cfg, "lab_operator", cfg.LAB_DB_NAME, 5);
  root = await connect(cfg, "root");
  deps = { operator, labDb: cfg.LAB_DB_NAME, fixtureDb: labFixtureDbName(cfg.LAB_DB_NAME) };
});
afterAll(async () => { await operator?.end(); await root?.end(); });

describe("scenarios produce validated traces that match the database", () => {
  it.each(SCENARIOS.map((s) => [s.id, s] as const))("%s", async (_id, def) => {
    const t = await runScenarioDef(deps, def);
    expect(t.status, t.error?.message).toBe(def.expected);
    expect(t.result.validation.checks.filter((c) => !c.ok)).toEqual([]);
    if (t.status === "failed") expect(t.error?.message).toBeTruthy();
    // Independent re-validation from a different session.
    const again = await validateTrace(root, t, { schema: cfg.LAB_DB_NAME });
    expect(again.mismatches).toEqual([]);
  });

  it("observes concrete outcomes", async () => {
    const run = (id: string) => runScenarioDef(deps, SCENARIOS.find((s) => s.id === id)!);
    const confirm = await run("proc.confirm_order");
    expect(confirm.changes).toContainEqual(expect.objectContaining({ table: "product_inventory", key: "101", kind: "updated" }));
    expect(confirm.events.some((e) => e.kind === "trigger_effect" && e.trigger === "au_sales_order")).toBe(true);
    expect((await run("proc.award_loyalty")).result.output.awarded_points).toBe(670);
    expect((await run("cc.f1_double_posting")).result.output.race_reproduced).toBe(true);
    const trans = await run("trig.invalid_transitions");
    expect(trans.error?.message).toContain("Invalid order status transition");
    const rb = await run("tx.rollback");
    expect(rb.result.checkpoints.some((c) => !c.persisted && c.changes.length > 0)).toBe(true);
    expect(rb.changes).toEqual([]);
  });
});

describe("root-less sandbox reset", () => {
  it("restores the fixture deterministically and never touches the app DB", async () => {
    const fx = labFixtureDbName(cfg.LAB_DB_NAME);
    const appBefore = await fingerprint(root, cfg.APP_DB_NAME, ORIGINAL_TABLES);
    const fixture = await fingerprint(root, fx, ORIGINAL_TABLES);
    await root.query(`UPDATE ${cfg.LAB_DB_NAME}.product_inventory SET qty_on_hand = 0`);
    await root.query(`DELETE FROM ${cfg.LAB_DB_NAME}.feedback`);
    await resetSandbox(deps);
    expect(await fingerprint(root, cfg.LAB_DB_NAME, ORIGINAL_TABLES)).toEqual(fixture);
    await resetSandbox(deps);
    expect(await fingerprint(root, cfg.LAB_DB_NAME, ORIGINAL_TABLES)).toEqual(fixture);
    expect(await fingerprint(root, cfg.APP_DB_NAME, ORIGINAL_TABLES)).toEqual(appBefore);
    expect(await q(root, `SELECT order_status s FROM ${cfg.LAB_DB_NAME}.sales_order WHERE order_id = 5002`)).toEqual([{ s: "delivered" }]);
  });
});
