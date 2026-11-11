import {
  dependenciesOf, fmtFd, fmtMvd, fmtSet, relation,
  type RelationAnalysis, type StageDefinition,
} from "@furni/database/src/lab/normalization";
import { BASIS_CLASS, BASIS_LABEL, NF_CLASS } from "./shared";

function RelationEntry({ name, analysis, open, role }: { name: string; analysis: RelationAnalysis; open: boolean; role: string }) {
  const schema = relation(name);
  const deps = dependenciesOf(name);
  const prime = new Set(analysis.prime);
  return (
    <details open={open} className="group rounded-xl border hairline bg-white/40 open:bg-white/60" data-testid="explorer-relation" data-relation={name}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2 focus-visible:outline-2">
        <span className="min-w-0">
          <span className="block truncate font-mono text-[0.8rem]">{name}</span>
          <span className="text-[0.65rem] uppercase tracking-wider text-ink-soft">{role}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.68rem] font-medium ${NF_CLASS[analysis.highest]}`} title="Highest normal form, computed from the design dependencies">
          {analysis.highest}
        </span>
      </summary>
      <div className="space-y-3 px-3 pb-3 text-[0.78rem]">
        <p className="text-ink-soft">{schema.description}</p>
        <div>
          <p className="eyebrow !text-[0.62rem]">Heading</p>
          <p className="mt-1 font-mono leading-relaxed">
            {schema.attributes.map((a, i) => (
              <span key={a}>
                <span className={prime.has(a) ? "font-semibold underline underline-offset-2" : schema.nonAtomic?.includes(a) ? "text-clay-deep" : ""}>{a}</span>
                {schema.generated?.includes(a) && <span className="text-ink-soft"> (generated)</span>}
                {i < schema.attributes.length - 1 ? ", " : ""}
              </span>
            ))}
          </p>
        </div>
        <div>
          <p className="eyebrow !text-[0.62rem]">Candidate keys (derived by closure)</p>
          <ul className="mt-1 font-mono">
            {analysis.keys.map((k) => <li key={k.join()}>{fmtSet(k)}<span className="text-ink-soft">⁺ = all attributes</span></li>)}
          </ul>
          <p className="mt-1 text-[0.7rem] text-ink-soft">{analysis.declaredKeysMatch ? "Matches the keys declared in the source DDL." : "Differs from the declared keys."}</p>
        </div>
        {deps.length > 0 && (
          <div>
            <p className="eyebrow !text-[0.62rem]">Dependencies</p>
            <ul className="mt-1 space-y-1.5">
              {deps.map((d) => (
                <li key={d.id} className="leading-snug">
                  <span className="font-mono">{d.kind === "fd" ? fmtFd(d.lhs, d.rhs) : fmtMvd(d.lhs, d.rhs)}</span>{" "}
                  <span className={`ml-1 inline-block rounded-full px-1.5 py-px text-[0.6rem] uppercase tracking-wider ${BASIS_CLASS[d.basis]}`}>{BASIS_LABEL[d.basis]}</span>
                  <span className="block text-[0.7rem] text-ink-soft">{d.rationale}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {analysis.violations.length > 0 && (
          <div>
            <p className="eyebrow !text-[0.62rem]">Violations</p>
            <ul className="mt-1 space-y-1">
              {analysis.violations.map((v, i) => <li key={i}><span className="font-medium text-clay-deep">{v.nf}:</span> {v.reason}</li>)}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

export function DependencyExplorer({ stage, analyses }: { stage: StageDefinition; analyses: RelationAnalysis[] }) {
  const byName = new Map(analyses.map((a) => [a.relation, a]));
  const groups: { title: string; names: string[]; open: boolean; role: string }[] = stage.id === "UNF"
    ? [{ title: "Relations", names: stage.relations, open: true, role: "unnormalised" }]
    : [
      { title: "Decomposed", names: stage.inputs, open: false, role: "input" },
      { title: "Produced", names: stage.outputs, open: stage.outputs.length <= 3, role: "output" },
      { title: "Unchanged", names: stage.relations.filter((r) => !stage.outputs.includes(r)), open: false, role: "carried over" },
    ];
  return (
    <section aria-labelledby="explorer-heading" className="space-y-4">
      <h2 id="explorer-heading" className="eyebrow">Dependency explorer</h2>
      <div className="rounded-xl bg-limestone/70 p-3 text-[0.8rem]">
        <p className="font-display text-lg leading-tight">{stage.id}: {stage.title}</p>
        <p className="mt-1">{stage.definition}</p>
        <p className="mt-2 text-ink-soft"><span className="font-medium text-charcoal">Rule.</span> {stage.rule}</p>
      </div>
      <div className="flex flex-wrap gap-1.5 text-[0.62rem] uppercase tracking-wider" aria-label="Legend">
        {(["declared", "assumed", "observed-in-sample"] as const).map((b) => (
          <span key={b} className={`rounded-full px-1.5 py-px ${BASIS_CLASS[b]}`}>{BASIS_LABEL[b]}</span>
        ))}
      </div>
      <p className="text-[0.72rem] text-ink-soft">Observed dependencies hold in the sample rows only. They are never used to derive keys or normal forms.</p>
      {groups.filter((g) => g.names.length).map((g) => (
        <div key={g.title} className="space-y-2">
          <h3 className="text-[0.72rem] font-medium uppercase tracking-wider text-ink-soft">{g.title}</h3>
          {g.names.map((n) => byName.get(n) && <RelationEntry key={n} name={n} analysis={byName.get(n)!} open={g.open} role={g.role} />)}
        </div>
      ))}
    </section>
  );
}
