import {
  decomposition, fmtFd, fmtSet, relation, sub,
  type Demonstration, type StageDefinition, type StageReport, type StructuralResult,
} from "@furni/database/src/lab/normalization";
import { BASIS_CLASS, BASIS_LABEL } from "./shared";

const Ok = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.68rem] font-medium ${ok ? "bg-sage/30 text-sage-deep" : "bg-clay/20 text-clay-deep"}`}>
    <span aria-hidden>{ok ? "✓" : "✗"}</span>{children}
  </span>
);

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="border-t hairline pt-3" data-testid={testId}>
      <h3 className="text-[0.72rem] font-medium uppercase tracking-wider text-ink-soft">{title}</h3>
      <div className="mt-2 space-y-2 text-[0.8rem] leading-relaxed">{children}</div>
    </section>
  );
}

function Structural({ s, showChase }: { s: StructuralResult; showChase: boolean }) {
  const d = decomposition(s.decompositionId);
  return (
    <article className="space-y-3 rounded-xl border hairline bg-white/45 p-3" data-testid="structural" data-decomposition={d.id}>
      <header>
        <p className="font-medium">{d.title}</p>
        <p className="mt-1 font-mono text-[0.72rem] text-ink-soft">
          {d.original.relation}{d.original.augment ? ` ⋈ π(${d.original.augment.on.concat(d.original.augment.attributes).join(", ")})${d.original.augment.relation}` : ""}
          {" → "}
          {d.parts.map((p, i) => `R${sub(i + 1)} = ${p.relation}(${p.attributes.map((a) => p.columns?.[a] ?? a).join(", ")})`).join(";  ")}
        </p>
      </header>
      {s.removes.length > 0 && (
        <div>
          <p className="text-[0.7rem] font-medium uppercase tracking-wider text-clay-deep">Violation removed</p>
          <ul className="mt-1 space-y-1">{s.removes.map((v, i) => <li key={i}>{v.reason}</li>)}</ul>
        </div>
      )}
      <div>
        <p className="flex flex-wrap items-center gap-2 text-[0.7rem] font-medium uppercase tracking-wider text-ink-soft">
          Lossless join <Ok ok={s.lossless}>{s.lossless ? "proved" : "not proved"}</Ok>
          <span className="normal-case tracking-normal">structural · {s.method}</span>
        </p>
        <ul className="mt-1 list-disc space-y-1 pl-4">{s.argument.map((a, i) => <li key={i}>{a}</li>)}</ul>
        {s.binarySteps.length > 0 && (
          <ol className="mt-2 space-y-1">
            {s.binarySteps.map((b, i) => (
              <li key={i} className="rounded-lg bg-porcelain/80 px-2 py-1">
                <span className="font-mono text-[0.78rem]" data-testid="lossless-notation">{b.notation}</span>
                <span className="block text-[0.7rem] text-ink-soft">
                  {fmtSet(b.common)}⁺ = {fmtSet(b.commonClosure)}
                </span>
              </li>
            ))}
          </ol>
        )}
        {showChase && s.chase && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[0.72rem] text-ink-soft underline underline-offset-2">Final chase tableau ({s.chase.rounds} round{s.chase.rounds === 1 ? "" : "s"})</summary>
            <div className="mt-1 overflow-x-auto">
              <table className="border-collapse font-mono text-[0.66rem]">
                <caption className="sr-only">Chase tableau; a row of only “a” symbols proves the join lossless</caption>
                <thead><tr><th scope="col" className="px-1 text-left">part</th>{s.chase.universe.map((u) => <th key={u} scope="col" className="px-1 text-left">{u}</th>)}</tr></thead>
                <tbody>
                  {s.chase.rows.map((r, i) => (
                    <tr key={i} className={i === s.chase!.losslessRow ? "bg-sage/30" : ""}>
                      <th scope="row" className="px-1 text-left font-normal">{r.label}</th>
                      {r.cells.map((c, j) => <td key={j} className={`px-1 ${c === "a" ? "font-semibold" : "text-ink-soft"}`}>{c}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
      <div>
        <p className="flex flex-wrap items-center gap-2 text-[0.7rem] font-medium uppercase tracking-wider text-ink-soft">
          Dependency preservation
          {s.preservation.applicable ? <Ok ok={s.preservation.preserved}>{s.preservation.preserved ? "preserved" : "not preserved"}</Ok> : <span className="normal-case tracking-normal">not applicable</span>}
        </p>
        <p className="mt-1">{s.preservation.note}</p>
        {s.preservation.items.length > 0 && (
          <ul className="mt-1 space-y-0.5 font-mono text-[0.74rem]">
            {s.preservation.items.map((p, i) => (
              <li key={i} data-testid="preservation-item" data-preserved={p.preserved}>
                <span aria-hidden className={p.preserved ? "text-sage-deep" : "text-clay-deep"}>{p.preserved ? "✓ " : "✗ "}</span>
                <span className="sr-only">{p.preserved ? "preserved: " : "lost: "}</span>
                {fmtFd(p.lhs, p.rhs)}
                <span className="font-sans text-[0.68rem] text-ink-soft"> {p.localTo ? `(inside ${p.localTo})` : p.preserved ? "(implied across relations)" : "(spans relations)"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <details>
        <summary className="cursor-pointer text-[0.72rem] text-ink-soft underline underline-offset-2">Assumptions this proof relies on ({s.assumptions.length})</summary>
        <ul className="mt-1 space-y-1">
          {s.assumptions.map((a, i) => (
            <li key={i}><span className="font-mono text-[0.74rem]">{a.dependency}</span> <span className={`rounded-full px-1.5 py-px text-[0.6rem] uppercase ${BASIS_CLASS[a.basis]}`}>{BASIS_LABEL[a.basis]}</span></li>
          ))}
        </ul>
      </details>
      {d.notes.length > 0 && <ul className="list-disc space-y-1 pl-4 text-[0.74rem] text-ink-soft">{d.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      <p className="text-[0.72rem] text-ink-soft">
        Source lines {d.source.map((r) => `${r.from}–${r.to}`).join(", ")}
        {d.scriptCheck && <> · script check <span className="font-mono">{d.scriptCheck.name}</span> (lines {d.scriptCheck.from}–{d.scriptCheck.to}): {d.scriptCheck.note}</>}
      </p>
    </article>
  );
}

export function ProofInspector({ stage, report, demonstrations, showChase }: {
  stage: StageDefinition; report: StageReport; demonstrations: { bcnf: Demonstration; f2: Demonstration }; showChase: boolean;
}) {
  const recon = report.checks.filter((c) => c.kind === "reconstruction");
  const deps = report.checks.filter((c) => c.kind !== "reconstruction");
  const demos = stage.id === "BCNF" ? [demonstrations.bcnf] : stage.id === "3NF" ? [demonstrations.f2] : [];
  const total = report.totals.violations;
  return (
    <section aria-labelledby="inspector-heading" className="space-y-4" data-testid="inspector" data-stage={stage.id}>
      <h2 id="inspector-heading" className="eyebrow">Proof &amp; verification inspector</h2>
      <Section title="Definition">
        <p>{stage.definition}</p>
        <p className="text-ink-soft">{stage.summary}</p>
      </Section>

      {stage.id === "UNF" ? (
        <Section title="Why this is not 1NF">
          <ul className="list-disc space-y-1 pl-4">
            {report.analyses.flatMap((a) => a.violations.filter((v) => v.nf === "1NF").map((v, i) => <li key={`${a.relation}${i}`}><span className="font-mono">{a.relation}.{v.rhs[0]}</span>: {v.reason}</li>))}
          </ul>
          <p className="text-ink-soft">Lines {stage.source.map((s) => `${s.from}–${s.to}`).join(", ")}.</p>
        </Section>
      ) : (
        <Section title="Decomposition and structural proof">
          {report.structural.map((s) => <Structural key={s.decompositionId} s={s} showChase={showChase} />)}
        </Section>
      )}

      {recon.length > 0 && (
        <Section title="Reconstruction SQL (runs live on the snapshot)">
          {recon.map((c) => (
            <details key={c.id} className="rounded-lg bg-charcoal text-porcelain">
              <summary className="cursor-pointer px-3 py-2 font-mono text-[0.72rem]">{c.label}</summary>
              <pre className="max-h-72 overflow-auto px-3 pb-3 font-mono text-[0.66rem] leading-relaxed" tabIndex={0} aria-label={`SQL for ${c.label}`}>{c.sql}</pre>
            </details>
          ))}
        </Section>
      )}

      <Section title="Live checks on the sample (evidence)" testId="live-checks">
        <div className="flex items-baseline justify-between gap-3 rounded-xl bg-white/50 px-3 py-2">
          <p>
            <span className="font-display text-3xl" data-testid="violation-total">{total}</span>{" "}
            <span className="text-ink-soft">violation{total === 1 ? "" : "s"} in {report.totals.checks} checks</span>
          </p>
          <Ok ok={report.totals.sqlAgrees === true}>{report.totals.sqlAgrees ? "SQL agrees" : "SQL differs"}</Ok>
        </div>
        {recon.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[0.74rem]">
              <caption className="sr-only">Reconstruction results</caption>
              <thead><tr className="text-left text-ink-soft">
                <th scope="col" className="py-1 pr-2 font-medium">Reconstruction</th>
                <th scope="col" className="px-1 font-medium">Rows</th>
                <th scope="col" className="px-1 font-medium">Missing</th>
                <th scope="col" className="px-1 font-medium">Spurious</th>
              </tr></thead>
              <tbody>
                {recon.map((c) => (
                  <tr key={c.id} className="border-t hairline" data-testid="reconstruction-row">
                    <th scope="row" className="py-1 pr-2 text-left font-mono font-normal">{c.label}</th>
                    <td className="px-1 font-mono">{c.detail.reconstructedRows}/{c.detail.originalRows}</td>
                    <td className="px-1 font-mono">{c.detail.missing}</td>
                    <td className="px-1 font-mono">{c.detail.spurious}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <details>
          <summary className="cursor-pointer text-[0.72rem] text-ink-soft underline underline-offset-2">All {deps.length} key, FD and MVD checks</summary>
          <table className="mt-1 w-full border-collapse text-[0.7rem]">
            <caption className="sr-only">Key, functional and multivalued dependency checks</caption>
            <thead><tr className="text-left text-ink-soft"><th scope="col" className="font-medium">Check</th><th scope="col" className="font-medium">Basis</th><th scope="col" className="font-medium">Viol.</th></tr></thead>
            <tbody>
              {deps.map((c) => (
                <tr key={c.id} className="border-t hairline">
                  <th scope="row" className="py-0.5 pr-1 text-left font-mono font-normal">{c.label}</th>
                  <td className="pr-1">{c.basis ? BASIS_LABEL[c.basis] : "key"}</td>
                  <td className="font-mono">{c.violations}{c.sqlViolations !== c.violations ? ` (SQL ${c.sqlViolations})` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        <p className="rounded-lg border border-dashed border-ink-soft/40 p-2 text-[0.72rem] text-ink-soft" data-testid="evidence-disclaimer">{report.disclaimer}</p>
      </Section>

      {demos.length > 0 && (
        <Section title="Demonstration">
          {demos.map((d) => (
            <div key={d.title} className="rounded-xl bg-limestone/70 p-3" data-testid="demonstration">
              <p className="font-medium">{d.title} <span className="text-[0.66rem] uppercase tracking-wider text-ink-soft">({d.claim}, in memory)</span></p>
              <p className="mt-1">{d.explanation}</p>
            </div>
          ))}
        </Section>
      )}
      <p className="text-[0.7rem] text-ink-soft">Snapshot tables: {stage.outputs.map((r) => relation(r).table).join(", ")}.</p>
    </section>
  );
}
