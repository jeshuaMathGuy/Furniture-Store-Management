import { randomUUID } from "node:crypto";
import mysql, { type PoolConnection, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import type { ExecutionStatus, Provenance } from "@furni/shared";
import type { Pool } from "../connection.js";
import { resetLabSandbox, type ResetReport } from "./fixture.js";
import {
  diffAll, mysqlErrorOf, snapshotTables, TraceRecorder, validateTrace,
  type LabTrace, type ScenarioCategory,
} from "./trace.js";

/**
 * Server-defined scenarios run through the lab_operator pool only. They never
 * accept SQL from the user; inputs are typed parameters bound with `?`.
 */
export interface Session { name: string; conn: PoolConnection }
export interface ExecOptions {
  session?: Session;
  /** Record a MySQL error as an event and continue instead of failing the run. */
  expectError?: boolean;
  /** Take a checkpoint of the watched tables (on the main session) after the statement. */
  checkpoint?: string;
  /** Mark that checkpoint as attempted-only (inside an open transaction). Default true = persisted. */
  persisted?: boolean;
}
export interface ExecResult {
  rows: Record<string, unknown>[];
  affectedRows?: number;
  error?: { message: string; code?: string; sqlState?: string };
  elapsedMs: number;
}
export interface SetupContext {
  exec(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}
export interface ScenarioContext {
  schema: string;
  main: Session;
  exec(sql: string, params?: unknown[], opts?: ExecOptions): Promise<ExecResult>;
  session(name: string): Promise<Session>;
  milestone(label: string): void;
  note(text: string): void;
  output(key: string, value: unknown): void;
  outcome(status: ExecutionStatus): void;
  checkpoint(label: string, persisted?: boolean): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** True if the promise is still unsettled after `ms` (used to observe a blocked session). */
  stillRunning(p: Promise<unknown>, ms: number): Promise<boolean>;
  /** Thread state of a session as seen in information_schema.PROCESSLIST (own threads only). */
  threadState(s: Session): Promise<string | null>;
  /** Unique named-lock name scoped to this sandbox. */
  lockName(suffix: string): string;
}

export interface ScenarioDef {
  id: string;
  category: ScenarioCategory;
  title: string;
  description: string;
  /** What the run demonstrates; the tests assert the observed status equals this. */
  expected: ExecutionStatus;
  provenance?: Provenance;
  /** Tables snapshotted before/after (dashboard tables are added automatically for mutating scenarios). */
  watch: string[];
  mutating: boolean;
  /** A failed or rolled-back run must leave no persisted change (checked in validation). */
  expectNoChanges?: boolean;
  objects: string[];
  inputs?: { name: string; label: string; type: "number" | "date"; default: string }[];
  setup?(s: SetupContext, input: Record<string, unknown>): Promise<void>;
  run(ctx: ScenarioContext, input: Record<string, unknown>): Promise<void>;
}

/** Tables behind the business dashboard layer of the trace player. */
export const DASHBOARD_TABLES = ["product_inventory", "sales_order", "loyalty_award", "supplier_settlement"] as const;

export interface LabDeps { operator: Pool; labDb: string; fixtureDb: string }

class RecordedError extends Error {
  constructor(readonly info: { message: string; code?: string; sqlState?: string }) { super(info.message); }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Serialise scenario runs and resets per sandbox with a MySQL named lock held by the main session. */
async function acquireSandbox(conn: PoolConnection, labDb: string, timeoutSec = 20) {
  const [[row]] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK(?, ?) AS ok", [`furni:lab:${labDb}`, timeoutSec]);
  if (Number(row?.ok) !== 1) throw new Error("The lab sandbox is busy with another run. Try again in a moment.");
}

export async function resetSandbox(deps: LabDeps): Promise<ResetReport> {
  const c = await deps.operator.getConnection();
  try {
    await acquireSandbox(c, deps.labDb);
    return await resetLabSandbox(c, deps.labDb, deps.fixtureDb);
  } finally {
    c.destroy(); // ends the session: releases the named lock and discards session settings
  }
}

export async function runScenarioDef(deps: LabDeps, def: ScenarioDef, input: Record<string, unknown> = {}): Promise<LabTrace> {
  const rec = new TraceRecorder();
  const schema = deps.labDb;
  const watch = def.mutating ? [...new Set([...def.watch, ...DASHBOARD_TABLES])] : def.watch;
  const provenance: Provenance = def.provenance ?? "observed";
  const mainConn = await deps.operator.getConnection();
  const main: Session = { name: "Main", conn: mainConn };
  const extra: Session[] = [];
  type ErrInfo = { message: string; code?: string; sqlState?: string };
  let explicit = null as ExecutionStatus | null;
  let firstError = null as ErrInfo | null;
  let uncaught = null as ErrInfo | null;

  try {
    await acquireSandbox(mainConn, schema);
    const reset = await resetLabSandbox(mainConn, schema, deps.fixtureDb);
    rec.notes.push(`Sandbox restored from the fixture before the run (${reset.rows} rows, ${reset.elapsedMs} ms).`);
    if (def.setup) {
      await def.setup({ exec: async (sql, params) => { const [r] = await mainConn.query(sql, params); return Array.isArray(r) ? (r as Record<string, unknown>[]) : []; } }, input);
      rec.notes.push("Preconditions were prepared after the reset and before the 'before' snapshot.");
    }
    const before = await snapshotTables(mainConn, schema, watch, provenance);
    const startedAt = new Date().toISOString();

    const checkpoint = async (label: string, persisted = true) => {
      const now = await snapshotTables(mainConn, schema, watch, provenance);
      rec.checkpoint(label, persisted, diffAll(before, now));
    };

    const exec: ScenarioContext["exec"] = async (sql, params, opts = {}) => {
      const s = opts.session ?? main;
      rec.sessions.add(s.name);
      const display = mysql.format(sql, params ?? []);
      const ev = rec.statement(s === main && extra.length === 0 ? display : `[${s.name}] ${display}`);
      const t0 = performance.now();
      try {
        const [res] = await s.conn.query(sql, params);
        const elapsedMs = Math.round(performance.now() - t0);
        let rows: Record<string, unknown>[] = [];
        let affectedRows: number | undefined;
        if (Array.isArray(res)) {
          // CALL returns [resultSets..., header]
          const header = res.find((x) => x && !Array.isArray(x) && typeof x === "object" && "affectedRows" in x) as ResultSetHeader | undefined;
          rows = (res.every((x) => !Array.isArray(x)) ? res : (res.find((x) => Array.isArray(x)) ?? [])) as Record<string, unknown>[];
          if (header) affectedRows = header.affectedRows;
          if (rows.length && "affectedRows" in (rows[0] as object) && "fieldCount" in (rows[0] as object)) rows = [];
        } else {
          affectedRows = (res as ResultSetHeader).affectedRows;
          const warn = (res as ResultSetHeader).warningStatus;
          if (warn) ev.warnings = warn;
        }
        if (affectedRows !== undefined) ev.affectedRows = affectedRows;
        if (opts.checkpoint) await checkpoint(opts.checkpoint, opts.persisted ?? true);
        return { rows, affectedRows, elapsedMs };
      } catch (e) {
        const elapsedMs = Math.round(performance.now() - t0);
        const info = mysqlErrorOf(e);
        rec.error(info);
        firstError ??= info;
        if (opts.checkpoint) await checkpoint(opts.checkpoint, opts.persisted ?? true);
        if (opts.expectError) return { rows: [], error: info, elapsedMs };
        throw new RecordedError(info);
      }
    };

    const ctx: ScenarioContext = {
      schema, main, exec,
      async session(name) {
        const conn = await deps.operator.getConnection();
        const s = { name, conn };
        extra.push(s);
        rec.sessions.add(name);
        return s;
      },
      milestone: (l) => rec.milestone(l),
      note: (t) => rec.notes.push(t),
      output: (k, v) => { rec.output[k] = v; },
      outcome: (s) => { explicit = s; },
      checkpoint,
      sleep,
      async stillRunning(p, ms) {
        let settled = false;
        p.then(() => { settled = true; }, () => { settled = true; });
        await sleep(ms);
        return !settled;
      },
      async threadState(s) {
        const [[r]] = await mainConn.query<RowDataPacket[]>("SELECT STATE AS state FROM information_schema.PROCESSLIST WHERE ID = ?", [s.conn.threadId]);
        return (r?.state as string | undefined) ?? null;
      },
      lockName: (suffix) => `furni:lab:${schema}:${suffix}`,
    };

    try {
      await def.run(ctx, input);
    } catch (e) {
      uncaught = e instanceof RecordedError ? e.info : mysqlErrorOf(e);
      if (!(e instanceof RecordedError)) rec.error(uncaught);
      for (const s of [main, ...extra]) await s.conn.query("ROLLBACK").catch(() => undefined);
      rec.milestone("Runner issued ROLLBACK on every session after the error");
    }

    const after = await snapshotTables(mainConn, schema, watch, provenance);
    const changes = diffAll(before, after);
    rec.checkpoint("Final persisted state", true, changes);
    const status: ExecutionStatus = uncaught ? "failed" : explicit ?? (changes.length ? "committed" : "read_only");
    const error = uncaught ?? (status === "failed" || status === "rolled_back" ? firstError : null);
    rec.outcome(status);

    const trace: LabTrace = {
      executionId: randomUUID(),
      scenarioId: def.id,
      operation: def.title,
      startedAt,
      finishedAt: new Date().toISOString(),
      status,
      input,
      before, after, changes,
      events: rec.events,
      ...(error ? { error } : {}),
      provenance,
      result: {
        title: def.title, category: def.category, expectedStatus: def.expected,
        output: rec.output, checkpoints: rec.checkpoints, notes: rec.notes, sessions: [...rec.sessions],
        validation: { ok: false, checkedAt: "", checks: [], mismatches: [] },
      },
    };
    const validation = await validateTrace(mainConn, trace, { schema });
    if (def.expectNoChanges && (status === "failed" || status === "rolled_back"))
      validation.checks.push({ name: "No persisted change after the failure (rollback confirmed)", ok: changes.length === 0, detail: `${changes.length} change(s) persisted` });
    validation.ok = validation.checks.every((c) => c.ok);
    trace.result.validation = validation;
    return trace;
  } finally {
    for (const s of extra) s.conn.destroy();
    mainConn.destroy();
  }
}
