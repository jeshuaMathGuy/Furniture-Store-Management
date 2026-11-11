"use server";

import { Parser } from "node-sql-parser/build/mysql";
import { requirePermission } from "@furni/database";
import type { Permission } from "@furni/shared";
import { runReadOnlySql, type SqlRunResult } from "@furni/database/src/lab/executor";
import { labFixtureDbName } from "@furni/database/src/lab/fixture";
import { resetSandbox, runScenarioDef, type LabDeps } from "@furni/database/src/lab/scenario-runner";
import { getScenario } from "@furni/database/src/lab/scenarios";
import type { LabTrace } from "@furni/database/src/lab/trace";
import { getSession } from "@/lib/server/auth";
import { labConfig, labOperator, labReader } from "@/lib/server/lab-db";

const parser = new Parser();

function deps(): LabDeps {
  const db = labConfig().LAB_DB_NAME;
  return { operator: labOperator(), labDb: db, fixtureDb: labFixtureDbName(db) };
}

async function gate(p: Permission) {
  requirePermission(await getSession(), p);
}

type Out<T> = { ok: true; data: T } | { ok: false; error: string };
async function guarded<T>(p: Permission, fn: () => Promise<T>): Promise<Out<T>> {
  try {
    await gate(p);
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: (e as { sqlMessage?: string; message?: string }).sqlMessage ?? (e as Error).message ?? "Failed" };
  }
}

/** User SQL: lab_reader pool only (SELECT-only account), classified, read-only transaction, time and row limits. */
export async function runSqlAction(sql: string, mode: "run" | "explain"): Promise<Out<SqlRunResult>> {
  if (typeof sql !== "string") return { ok: false, error: "Invalid input" };
  return guarded("lab:read", () => runReadOnlySql(labReader(), sql, { parser, mode }));
}

/** Server-defined scenario through lab_operator. The id selects code; no SQL is accepted from the client. */
export async function runScenarioAction(id: string, input: Record<string, string>): Promise<Out<LabTrace>> {
  const def = typeof id === "string" ? getScenario(id) : undefined;
  if (!def) return { ok: false, error: "Unknown scenario" };
  const clean: Record<string, string> = {};
  for (const i of def.inputs ?? []) {
    const v = String(input?.[i.name] ?? i.default);
    if (i.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, error: `${i.label} must be a date` };
    clean[i.name] = v;
  }
  return guarded("lab:scenario:run", () => runScenarioDef(deps(), def, clean));
}

export async function resetLabAction(): Promise<Out<{ rows: number; elapsedMs: number }>> {
  return guarded("lab:reset", async () => {
    const r = await resetSandbox(deps());
    return { rows: r.rows, elapsedMs: r.elapsedMs };
  });
}
