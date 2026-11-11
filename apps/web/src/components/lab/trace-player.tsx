"use client";

import { useState } from "react";
import type { RowChange } from "@furni/shared";
import type { LabTrace } from "@furni/database/src/lab/trace";

const KIND_STYLE: Record<RowChange["kind"], string> = {
  inserted: "bg-sage/25",
  updated: "bg-clay/20",
  deleted: "bg-charcoal/10 line-through",
};
const KIND_LABEL: Record<RowChange["kind"], string> = { inserted: "ADDED", updated: "UPDATED", deleted: "REMOVED" };

function fmt(v: unknown) { return v === null || v === undefined ? "NULL" : typeof v === "object" ? JSON.stringify(v) : String(v); }

function ChangeList({ changes }: { changes: RowChange[] }) {
  if (changes.length === 0) return <p className="text-sm text-ink-soft">No row differs from the before-state.</p>;
  return (
    <ul className="space-y-1.5 font-mono text-xs" data-testid="trace-changes">
      {changes.map((c) => (
        <li key={`${c.table}#${c.key}#${c.kind}`} className={`rounded-md px-2 py-1.5 ${KIND_STYLE[c.kind]}`}>
          <span className="mr-2 rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold not-italic">{KIND_LABEL[c.kind]}</span>
          {c.table} [{c.key}]{" "}
          {c.kind === "updated"
            ? c.changedColumns.map((col) => `${col}: ${fmt(c.before[col])} → ${fmt(c.after[col])}`).join(", ")
            : Object.entries(c.kind === "inserted" ? c.after : c.before).map(([k, v]) => `${k}=${fmt(v)}`).join(" ")}
        </li>
      ))}
    </ul>
  );
}

/** Step-through view of one server-produced trace: timeline on the left, table diff at that step on the right. */
export function TracePlayer({ trace }: { trace: LabTrace }) {
  const events = trace.events;
  const [i, setI] = useState(events.length - 1);
  const ev = events[i];
  const seq = ev?.seq ?? 0;
  const cps = trace.result.checkpoints.filter((c) => c.afterSeq <= seq);
  const cp = cps[cps.length - 1];
  const v = trace.result.validation;

  return (
    <div className="rounded-2xl border hairline bg-white/40 p-4" data-testid="trace-player" data-status={trace.status}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <strong>{trace.operation}</strong>
        <span className="rounded-full bg-charcoal px-2 py-0.5 text-xs text-porcelain" data-testid="trace-status">{trace.status}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${v.ok ? "bg-sage/30" : "bg-clay/25 text-clay-deep"}`} data-testid="trace-validation">
          {v.ok ? "Validated against MySQL" : "VALIDATION MISMATCH"}
        </span>
        <span className="text-xs text-ink-soft">{trace.provenance === "observed" ? "Observed" : "Instructional simulation"}</span>
      </div>
      {trace.error && <p role="alert" className="mt-2 rounded-lg bg-clay/12 px-3 py-2 text-sm text-clay-deep" data-testid="trace-error">MySQL: {trace.error.message}{trace.error.code ? ` (${trace.error.code})` : ""}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost h-9 px-3 text-xs" onClick={() => setI(0)}>Reset</button>
        <button type="button" className="btn btn-ghost h-9 px-3 text-xs" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i <= 0}>Previous</button>
        <button type="button" className="btn btn-ghost h-9 px-3 text-xs" onClick={() => setI((x) => Math.min(events.length - 1, x + 1))} disabled={i >= events.length - 1}>Next</button>
        <span className="self-center text-xs text-ink-soft">Step {i + 1} of {events.length}</span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <ol className="max-h-[420px] space-y-1 overflow-auto text-xs" aria-label="Execution timeline">
          {events.map((e, k) => (
            <li key={e.seq}>
              <button type="button" onClick={() => setI(k)} aria-current={k === i ? "step" : undefined}
                className={`w-full rounded-md px-2 py-1.5 text-left ${k === i ? "bg-brass/25" : k < i ? "" : "opacity-50"}`}>
                <span className="mr-1 text-ink-soft">{e.seq}.</span>
                {e.kind === "statement" && <span className="font-mono">{e.sql}{e.affectedRows !== undefined ? ` → ${e.affectedRows} row(s)` : ""}</span>}
                {e.kind === "milestone" && <em>{e.label}</em>}
                {e.kind === "trigger_effect" && <span className="text-sage-deep">Trigger {e.trigger} wrote {e.table} [{e.key}]</span>}
                {e.kind === "error" && <span className="text-clay-deep">Error {e.code ?? ""}: {e.message}</span>}
                {e.kind === "outcome" && <strong>Outcome: {e.status}</strong>}
              </button>
            </li>
          ))}
        </ol>
        <div>
          <p className="eyebrow">{cp ? cp.label : "Before (no statement run yet)"}{cp && !cp.persisted && <span className="ml-2 rounded bg-clay/20 px-1.5 text-clay-deep">ATTEMPTED · not persisted</span>}</p>
          <div className="mt-2"><ChangeList changes={cp?.changes ?? []} /></div>
          {Object.keys(trace.result.output).length > 0 && (
            <pre className="mt-3 overflow-auto rounded-lg bg-limestone/60 p-2 text-xs" data-testid="trace-output">{JSON.stringify(trace.result.output, null, 2)}</pre>
          )}
        </div>
      </div>

      <details className="mt-4 text-xs">
        <summary className="cursor-pointer">Validation and notes</summary>
        <ul className="mt-2 space-y-1">
          {v.checks.map((c) => <li key={c.name}>{c.ok ? "PASS" : "FAIL"} · {c.name}{c.detail ? ` (${c.detail})` : ""}</li>)}
          {v.mismatches.map((m) => <li key={`${m.table}${m.key}`} className="text-clay-deep">Mismatch {m.kind}: {m.table} [{m.key}]</li>)}
          {trace.result.notes.map((n) => <li key={n} className="text-ink-soft">{n}</li>)}
        </ul>
      </details>
    </div>
  );
}
