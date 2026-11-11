"use client";

import { useState, useTransition } from "react";
import type { ScenarioSummary } from "@furni/database/src/lab/scenarios";
import type { LabTrace } from "@furni/database/src/lab/trace";
import { resetLabAction, runScenarioAction } from "./server/actions";
import { TracePlayer } from "./trace-player";

/** Run server-defined scenarios (lab_operator) and step through the resulting traces. */
export function ScenarioLab({ scenarios, canRun }: { scenarios: ScenarioSummary[]; canRun: boolean }) {
  const [trace, setTrace] = useState<LabTrace | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  const run = (id: string) => start(async () => {
    setBusy(id); setMessage(null);
    const r = await runScenarioAction(id, inputs[id] ?? {});
    setBusy(null);
    if (r.ok) setTrace(r.data); else setMessage(r.error);
  });
  const reset = () => start(async () => {
    setBusy("reset");
    const r = await resetLabAction();
    setBusy(null);
    setMessage(r.ok ? `Sandbox restored from the fixture (${r.data.rows} rows in ${r.data.elapsedMs} ms).` : r.error);
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div>
        {canRun ? (
          <button type="button" className="btn btn-ghost h-9 px-3 text-xs" onClick={reset} disabled={!!busy} data-testid="reset-sandbox">
            {busy === "reset" ? "Resetting…" : "Reset sandbox"}
          </button>
        ) : <p className="text-sm text-ink-soft">Your role can read the lab but not run scenarios.</p>}
        <ul className="mt-4 space-y-3">
          {scenarios.map((s) => (
            <li key={s.id} className="rounded-2xl border hairline p-4 text-sm" data-scenario={s.id}>
              <p className="font-medium">{s.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">{s.description}</p>
              {s.inputs.map((i) => (
                <label key={i.name} className="mt-2 block text-xs">{i.label}
                  <input type="date" className="field mt-1 h-9" defaultValue={i.default}
                    onChange={(e) => setInputs((x) => ({ ...x, [s.id]: { ...x[s.id], [i.name]: e.target.value } }))} />
                </label>
              ))}
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-ink-soft">Expected: {s.expected}</span>
                {canRun && (
                  <button type="button" className="btn btn-primary h-8 px-3 text-xs" onClick={() => run(s.id)} disabled={!!busy}>
                    {busy === s.id ? "Running…" : "Run"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div aria-live="polite" className="min-w-0">
        {message && <p className="mb-3 rounded-lg bg-limestone px-3 py-2 text-sm" data-testid="lab-message">{message}</p>}
        {trace ? <TracePlayer key={trace.executionId} trace={trace} /> : <p className="text-sm text-ink-soft">Run a scenario to see its trace: statements, trigger effects, the before/after diff and the outcome reported by MySQL. Each run starts from a fresh copy of the sandbox.</p>}
      </div>
    </div>
  );
}
