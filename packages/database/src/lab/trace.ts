import type { RowDataPacket } from "mysql2";
import type {
  ExecutionStatus, ExecutionTrace, Provenance, Row, RowChange, TableSnapshot, TraceEvent,
} from "@furni/shared";
import { diffSnapshots, snapshotTable } from "../snapshot.js";

/**
 * Stage 7 trace engine. A trace is produced only on the server, from observed
 * database state: snapshots of the watched tables before and after, the
 * statements issued, milestones, trigger effects (new audit_log and
 * order_status_history rows) and the outcome reported by MySQL.
 *
 * The shared ExecutionTrace contract is implemented as is; lab-specific extras
 * (intermediate checkpoints, validation, output values) live in `result`.
 */
export type ScenarioCategory = "procedure" | "trigger" | "function" | "transaction" | "concurrency";

/** State of the watched tables at a point in the run, relative to `before`. */
export interface TraceCheckpoint {
  /** Last event seq included in this state. */
  afterSeq: number;
  label: string;
  /** false: visible only inside an open transaction (attempted), not persisted. */
  persisted: boolean;
  changes: RowChange[];
}

export interface TraceMismatch { table: string; key: string; kind: "missing" | "unexpected" | "different"; expected?: Row; actual?: Row }
export interface TraceValidation {
  ok: boolean;
  checkedAt: string;
  checks: { name: string; ok: boolean; detail?: string }[];
  mismatches: TraceMismatch[];
}

export interface LabTraceResult {
  title: string;
  category: ScenarioCategory;
  expectedStatus: ExecutionStatus;
  output: Record<string, unknown>;
  checkpoints: TraceCheckpoint[];
  validation: TraceValidation;
  notes: string[];
  sessions: string[];
}
export type LabTrace = ExecutionTrace & { result: LabTraceResult };

type Q = { query: <T extends RowDataPacket[]>(sql: string, values?: unknown[]) => Promise<[T, unknown]> };

export async function snapshotTables(conn: Q, schema: string, tables: readonly string[], provenance: Provenance = "observed"): Promise<TableSnapshot[]> {
  const out: TableSnapshot[] = [];
  for (const t of tables) out.push(await snapshotTable(conn, schema, t, { provenance }));
  return out;
}

export function diffAll(before: TableSnapshot[], after: TableSnapshot[]): RowChange[] {
  const changes: RowChange[] = [];
  for (const b of before) {
    const a = after.find((x) => x.table === b.table);
    if (a) changes.push(...diffSnapshots(b, a));
  }
  return changes;
}

/** Which original trigger wrote a row (only the triggers write these two tables). */
export function triggerFor(change: RowChange): string | null {
  if (change.kind !== "inserted") return null;
  if (change.table === "order_status_history") return "au_sales_order";
  if (change.table === "audit_log") return change.after.entity_name === "product" ? "au_product" : "au_sales_order";
  return null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Compare stored snapshots with fresh ones (ignores capturedAt). */
export function compareSnapshots(expected: TableSnapshot[], actual: TableSnapshot[]): TraceMismatch[] {
  const out: TraceMismatch[] = [];
  for (const e of expected) {
    const a = actual.find((x) => x.table === e.table);
    const am = new Map((a?.rows ?? []).map((r) => [r.key, r.values]));
    const em = new Map(e.rows.map((r) => [r.key, r.values]));
    for (const [k, v] of em) {
      const got = am.get(k);
      if (!got) out.push({ table: e.table, key: k, kind: "missing", expected: v });
      else if (!same(got, v)) out.push({ table: e.table, key: k, kind: "different", expected: v, actual: got });
    }
    for (const [k, v] of am) if (!em.has(k)) out.push({ table: e.table, key: k, kind: "unexpected", actual: v });
  }
  return out;
}

function changeKey(c: RowChange) { return `${c.table}#${c.key}#${c.kind}`; }

/**
 * Validate a trace against the database: re-read the after-state from MySQL and
 * check it equals trace.after, check that trace.changes is exactly the diff of
 * before/after, and that the outcome is consistent with the events.
 * Mismatches are returned, never hidden.
 */
export async function validateTrace(conn: Q, trace: ExecutionTrace, opts: { schema?: string } = {}): Promise<TraceValidation> {
  const checks: TraceValidation["checks"] = [];
  const schema = opts.schema ?? trace.after[0]?.schema ?? "";
  const fresh = await snapshotTables(conn, schema, trace.after.map((s) => s.table));
  const mismatches = compareSnapshots(trace.after, fresh);
  checks.push({
    name: "Re-read after-state equals trace.after",
    ok: mismatches.length === 0,
    detail: mismatches.length ? `${mismatches.length} row(s) differ from the database` : `${fresh.reduce((n, s) => n + s.rows.length, 0)} rows in ${fresh.length} tables re-read and identical`,
  });
  const recomputed = diffAll(trace.before, trace.after).map(changeKey).sort();
  const stored = trace.changes.map(changeKey).sort();
  checks.push({ name: "trace.changes equals diff(before, after)", ok: same(recomputed, stored), detail: `${stored.length} change(s)` });
  const outcome = trace.events.find((e) => e.kind === "outcome");
  checks.push({ name: "Outcome event matches status", ok: !!outcome && outcome.kind === "outcome" && outcome.status === trace.status });
  if (trace.status === "failed") checks.push({ name: "Failed run carries the database error", ok: !!trace.error?.message });
  return { ok: checks.every((c) => c.ok), checkedAt: new Date().toISOString(), checks, mismatches };
}

/** Mutable builder for a trace while a scenario runs. */
export class TraceRecorder {
  readonly events: TraceEvent[] = [];
  readonly checkpoints: TraceCheckpoint[] = [];
  readonly notes: string[] = [];
  readonly output: Record<string, unknown> = {};
  readonly sessions = new Set<string>();
  private seq = 0;
  private seenEffects = new Set<string>();

  next() { return ++this.seq; }
  get lastSeq() { return this.seq; }

  statement(sql: string): Extract<TraceEvent, { kind: "statement" }> {
    const e = { seq: this.next(), kind: "statement" as const, sql };
    this.events.push(e);
    return e;
  }
  milestone(label: string) { this.events.push({ seq: this.next(), kind: "milestone", label }); }
  error(err: { message: string; code?: string; sqlState?: string }) {
    this.events.push({ seq: this.next(), kind: "error", message: err.message, code: err.code, sqlState: err.sqlState });
  }
  outcome(status: ExecutionStatus) { this.events.push({ seq: this.next(), kind: "outcome", status }); }

  /** Record a checkpoint and emit trigger_effect events for audit/history rows not seen before. */
  checkpoint(label: string, persisted: boolean, changes: RowChange[]) {
    for (const c of changes) {
      const trig = triggerFor(c);
      const id = `${c.table}#${c.key}`;
      if (trig && !this.seenEffects.has(id)) {
        this.seenEffects.add(id);
        this.events.push({ seq: this.next(), kind: "trigger_effect", trigger: trig, table: c.table, key: c.key });
      }
    }
    this.checkpoints.push({ afterSeq: this.seq, label, persisted, changes });
  }
}

export function mysqlErrorOf(e: unknown): { message: string; code?: string; sqlState?: string } {
  const x = e as { message?: string; sqlMessage?: string; code?: string; sqlState?: string };
  return { message: x?.sqlMessage ?? x?.message ?? String(e), code: x?.code, sqlState: x?.sqlState };
}
