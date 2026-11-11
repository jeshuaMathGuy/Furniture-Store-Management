"use client";

import { useState, useTransition } from "react";
import type { SqlRunResult } from "@furni/database/src/lab/executor";
import type { LabQuery } from "@furni/database/src/lab/queries";
import { runSqlAction } from "./server/actions";

function cell(v: unknown) {
  if (v === null || v === undefined) return <span className="text-ink-soft italic">NULL</span>;
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

export function SqlPlayground({ examples }: { examples: LabQuery[] }) {
  const [sql, setSql] = useState(examples[0]?.sql ?? "SELECT 1");
  const [active, setActive] = useState<LabQuery | null>(examples[0] ?? null);
  const [result, setResult] = useState<SqlRunResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (mode: "run" | "explain") => start(async () => {
    const r = await runSqlAction(sql, mode);
    if (r.ok) { setResult(r.data); setFailure(null); } else { setResult(null); setFailure(r.error); }
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <aside>
        <p className="eyebrow">Examples</p>
        <ul className="mt-3 space-y-1" data-testid="example-list">
          {examples.map((q) => (
            <li key={q.id}>
              <button type="button" onClick={() => { setSql(q.sql); setActive(q); setResult(null); }}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-limestone ${active?.id === q.id ? "bg-limestone" : ""}`}>
                <span className="block font-medium">{q.title}</span>
                <span className="block text-xs text-ink-soft">{q.concept}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="min-w-0">
        <label htmlFor="sql-editor" className="eyebrow">SQL (read-only)</label>
        <textarea id="sql-editor" data-testid="sql-editor" value={sql} onChange={(e) => setSql(e.target.value)} spellCheck={false} rows={9}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") run("run"); }}
          className="mt-2 w-full rounded-xl border hairline bg-white/60 p-3 font-mono text-sm leading-relaxed" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary" onClick={() => run("run")} disabled={pending}>{pending ? "Running…" : "Run"}</button>
          <button type="button" className="btn btn-ghost" onClick={() => run("explain")} disabled={pending}>Explain (FORMAT=JSON)</button>
          <span className="text-xs text-ink-soft">Ctrl+Enter runs. One SELECT / WITH / EXPLAIN / SHOW / DESCRIBE, max 3 s, max 500 rows.</span>
        </div>
        {active && <p className="mt-4 rounded-xl bg-limestone/60 p-3 text-sm"><strong>{active.concept}.</strong> {active.explanation} <span className="text-ink-soft">Input relations: {active.inputs.join(", ")}.</span></p>}

        <div aria-live="polite" className="mt-5">
          {failure && <p role="alert" className="rounded-lg bg-clay/12 px-3 py-2 text-sm text-clay-deep">{failure}</p>}
          {result && !result.ok && (
            <p role="alert" data-testid="sql-error" className="rounded-lg bg-clay/12 px-3 py-2 text-sm text-clay-deep">
              {result.stage === "classify" ? "Rejected before execution: " : `MySQL error${result.error.errno ? ` ${result.error.errno}` : ""}${result.error.sqlState ? ` (${result.error.sqlState})` : ""}: `}
              {result.error.message}
            </p>
          )}
          {result?.ok && (
            <div data-testid="sql-result">
              <p className="text-xs text-ink-soft">
                {result.kind.toUpperCase()} · {result.rowCount} row{result.rowCount === 1 ? "" : "s"} · {result.elapsedMs} ms
                {result.truncated && <strong className="ml-2 text-clay-deep">Truncated to the first {result.limits.rowLimit} rows.</strong>}
                {result.hitTimeLimit && <strong className="ml-2 text-clay-deep">Stopped at the {result.limits.maxExecutionMs} ms limit.</strong>}
              </p>
              {result.plan?.json !== undefined ? (
                <pre className="mt-2 max-h-[480px] overflow-auto rounded-xl bg-charcoal p-4 text-xs text-porcelain" data-testid="sql-plan">{JSON.stringify(result.plan.json, null, 2)}</pre>
              ) : (
                <div className="mt-2 max-h-[480px] overflow-auto rounded-xl border hairline">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-limestone">
                      <tr>{result.columns.map((c, i) => <th key={i} scope="col" className="px-3 py-2 font-medium">{c.name}<span className="block font-normal text-ink-soft">{c.type}</span></th>)}</tr>
                    </thead>
                    <tbody className="font-mono">
                      {result.rows.map((r, i) => <tr key={i} className="border-t hairline">{r.map((v, j) => <td key={j} className="whitespace-pre px-3 py-1.5">{cell(v)}</td>)}</tr>)}
                    </tbody>
                  </table>
                </div>
              )}
              {result.warnings.length > 0 && <ul className="mt-2 text-xs text-clay-deep">{result.warnings.map((w, i) => <li key={i}>{w.level} {w.code}: {w.message}</li>)}</ul>}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
