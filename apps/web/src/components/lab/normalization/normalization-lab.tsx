"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  STAGES, decomposition, relation,
  type NfViolation, type NormalizationLabData, type StageDefinition, type StageReport,
} from "@furni/database/src/lab/normalization";
import { DependencyExplorer } from "./dependency-explorer";
import { ProofInspector } from "./proof-inspector";
import { RelationCard } from "./relation-card";
import { highlightMap, phasesFor, rowGroupKey, tint } from "./shared";

const STEP_MS = 1500;
const finalPhase = (i: number) => phasesFor(STAGES[i]!.id).length - 1;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

type Located = NfViolation & { relation: string };

function violationsFor(stage: StageDefinition, report: StageReport): Located[] {
  if (stage.id === "UNF") return report.analyses.flatMap((a) => a.violations.filter((v) => v.nf === "1NF").map((v) => ({ ...v, relation: a.relation })));
  return report.structural.flatMap((s) => s.removes.map((v) => ({ ...v, relation: decomposition(s.decompositionId).original.relation })));
}

/** Attributes a relation carries under the universe names used by the proofs (e.g. customer.email ≡ customer_email). */
function canonicalAttrs(stage: StageDefinition, name: string): string[] {
  const parts = stage.decompositions.flatMap((d) => decomposition(d).parts).filter((p) => p.relation === name);
  return [...relation(name).attributes, ...parts.flatMap((p) => p.attributes)];
}

function Canvas({ stage, report, phase, data, reduced }: {
  stage: StageDefinition; report: StageReport; phase: number; data: NormalizationLabData; reduced: boolean;
}) {
  const phaseId = phasesFor(stage.id)[phase]!.id;
  const violations = useMemo(() => violationsFor(stage, report), [stage, report]);
  const keysOf = (n: string) => report.analyses.find((a) => a.relation === n)?.keys ?? relation(n).declaredKeys;
  const highlightOn = phase >= 1;
  const groupTints = useMemo(() => {
    if (stage.id !== "1NF" && stage.id !== "UNF") return undefined;
    const keys = [...(data.sample.unf_sales_order ?? []), ...(data.sample.unf_supplier ?? [])].map(rowGroupKey);
    return new Map(keys.map((k, i) => [k, i % 3]));
  }, [stage.id, data.sample]);
  const tintsOn = stage.id === "1NF" && highlightOn;

  const headTint = (name: string): number | null => {
    const attrs = canonicalAttrs(stage, name);
    const i = violations.findIndex((v) => v.kind !== "non-atomic" && v.lhs.every((a) => attrs.includes(a)) && v.rhs.some((a) => attrs.includes(a)));
    return i >= 0 ? i : null;
  };

  const card = (name: string, opts: { state: "present" | "dim" | "entering"; rowsVisible: boolean; input: boolean }) => (
    <RelationCard key={name} schema={relation(name)} rows={data.sample[name] ?? []} keys={keysOf(name)}
      highlight={opts.input && highlightOn ? highlightMap(violations, name) : undefined}
      headTint={opts.input ? null : headTint(name)} state={opts.state} rowsVisible={opts.rowsVisible}
      groupTints={tintsOn ? groupTints : undefined} expandJson
      badge={relation(name).kind === "permanent" ? "table" : "session"} />
  );

  const carried = stage.relations.filter((r) => !stage.outputs.includes(r) && !stage.inputs.includes(r));
  const recon = report.checks.filter((c) => c.kind === "reconstruction");

  return (
    <div className="space-y-5" data-testid="canvas" data-stage={stage.id} data-phase={phaseId} data-reduced={reduced ? "true" : "false"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="eyebrow">Relational canvas</h2>
        <p className="text-[0.75rem] text-ink-soft">{phasesFor(stage.id)[phase]!.label}</p>
      </div>

      {highlightOn && violations.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-[0.72rem]" aria-label="Highlighted dependencies">
          {violations.map((v, i) => (
            <li key={i} className={`rounded-full px-2.5 py-1 ${tint(i).head}`}>
              <span className="font-medium">{v.nf}</span>{" "}
              <span className="font-mono">{v.kind === "non-atomic" ? `${v.relation}.${v.rhs[0]} is a JSON array` : `${v.relation}: ${v.lhs.join(", ")} → ${v.rhs.join(", ")}`}</span>
            </li>
          ))}
        </ul>
      )}

      {stage.id === "UNF" ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {stage.relations.map((n) => card(n, { state: "present", rowsVisible: true, input: true }))}
        </div>
      ) : (
        <>
          {phase <= 2 ? (
            <div>
              <p className="mb-2 text-[0.7rem] uppercase tracking-wider text-ink-soft">Before · {stage.inputs.length === 1 ? "1 relation" : `${stage.inputs.length} relations`}</p>
              <div className="grid gap-4 xl:grid-cols-2">
                {stage.inputs.map((n) => card(n, { state: phase === 2 ? "dim" : "present", rowsVisible: true, input: true }))}
              </div>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed hairline px-3 py-2 text-[0.75rem] text-ink-soft">
              Decomposed: <span className="font-mono">{stage.inputs.join(", ")}</span>
            </p>
          )}
          {phase >= 2 && (
            <div>
              <p className="mb-2 flex items-center gap-2 text-[0.7rem] uppercase tracking-wider text-ink-soft">
                <span aria-hidden className="text-base">↓</span> After · {stage.outputs.length} relations
              </p>
              <div className="grid gap-4 xl:grid-cols-2">
                {stage.outputs.map((n) => card(n, { state: phase === 2 ? "entering" : "present", rowsVisible: phase >= 3, input: false }))}
              </div>
            </div>
          )}
          {phase >= 4 && (
            <ul className="space-y-2" aria-label="Reconstruction results">
              {recon.map((c) => (
                <li key={c.id} data-testid="canvas-verified"
                  className={`animate-[nf-enter_480ms_var(--ease-arch)_both] rounded-xl px-3 py-2 text-[0.78rem] ${c.violations === 0 ? "bg-sage/25 text-sage-deep" : "bg-clay/20 text-clay-deep"}`}>
                  <span aria-hidden>{c.violations === 0 ? "✓ " : "✗ "}</span>
                  <span className="font-mono">{c.label}</span>: {c.detail.reconstructedRows} of {c.detail.originalRows} rows, {c.detail.missing} missing, {c.detail.spurious} spurious
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {carried.length > 0 && (
        <p className="text-[0.72rem] text-ink-soft">
          Unchanged at this stage: {carried.map((r) => <span key={r} className="mr-1.5 inline-block rounded-full bg-limestone px-2 py-0.5 font-mono">{r}</span>)}
        </p>
      )}
    </div>
  );
}

export function NormalizationLab({ data }: { data: NormalizationLabData }) {
  const reduced = usePrefersReducedMotion();
  const [stageIdx, setStageIdx] = useState(0);
  const [phase, setPhase] = useState(0);
  const [playing, setPlaying] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const stage = STAGES[stageIdx]!;
  const report = data.reports[stageIdx]!;
  const phases = phasesFor(stage.id);
  const lastPhase = phases.length - 1;
  const atEnd = stageIdx === STAGES.length - 1 && phase === lastPhase;

  // Reduced motion: every navigation lands on the end state of its stage.
  useEffect(() => { if (reduced) setPhase(finalPhase(stageIdx)); }, [reduced, stageIdx]);

  const goStage = useCallback((i: number) => {
    const next = Math.max(0, Math.min(STAGES.length - 1, i));
    setStageIdx(next);
    setPhase(reduced ? finalPhase(next) : 0);
  }, [reduced]);

  const step = useCallback((dir: 1 | -1) => {
    if (dir === 1) {
      if (phase < lastPhase && !reduced) setPhase(phase + 1);
      else if (stageIdx < STAGES.length - 1) goStage(stageIdx + 1);
    } else {
      if (phase > 0 && !reduced) setPhase(phase - 1);
      else if (stageIdx > 0) { setStageIdx(stageIdx - 1); setPhase(finalPhase(stageIdx - 1)); }
    }
  }, [phase, lastPhase, reduced, stageIdx, goStage]);

  useEffect(() => {
    if (!playing) return;
    if (atEnd) { setPlaying(false); return; }
    const t = window.setTimeout(() => step(1), STEP_MS);
    return () => window.clearTimeout(t);
  }, [playing, atEnd, step]);

  const interrupt = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => { setPlaying(false); fn(...a); };
  const reset = () => { setPlaying(false); setStageIdx(0); setPhase(reduced ? finalPhase(0) : 0); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, pre") || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowRight") { e.preventDefault(); setPlaying(false); step(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setPlaying(false); step(-1); }
  };

  const announcement = `Stage ${stageIdx + 1} of ${STAGES.length}, ${stage.id}: ${stage.title}. Step ${phase + 1} of ${phases.length}: ${phases[phase]!.label}. ${report.totals.violations} violations in ${report.totals.checks} live checks.`;
  const btn = "btn btn-ghost h-10 px-3 text-[0.8rem]";

  return (
    <div ref={rootRef} onKeyDown={onKeyDown} className="relative">
      <style>{`@keyframes nf-enter { from { opacity: 0; transform: translateY(10px) scale(0.985); } to { opacity: 1; transform: none; } }`}</style>
      <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="announcer">{announcement}</p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_minmax(0,22rem)]">
        <div className="order-2 lg:order-1 lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto lg:pr-1">
          <DependencyExplorer stage={stage} analyses={report.analyses} />
        </div>
        <div className="order-1 min-w-0 lg:order-2">
          <Canvas stage={stage} report={report} phase={phase} data={data} reduced={reduced} />
        </div>
        <div className="order-3 lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto lg:pl-1">
          <ProofInspector stage={stage} report={report} demonstrations={data.demonstrations} showChase />
        </div>
      </div>

      <div className="sticky bottom-0 z-10 mt-8 border-t hairline bg-porcelain/92 py-3 backdrop-blur">
        <nav aria-label="Normalization stages">
          <ol className="grid grid-cols-6 gap-1">
            {STAGES.map((s, i) => (
              <li key={s.id}>
                <button type="button" onClick={interrupt(() => goStage(i))} aria-current={i === stageIdx ? "step" : undefined}
                  data-testid="stage-button" data-stage={s.id}
                  className={`w-full rounded-lg px-1 py-1.5 text-center text-[0.78rem] font-medium transition-colors ${i === stageIdx ? "bg-charcoal text-porcelain" : i < stageIdx ? "bg-sage/25 text-sage-deep hover:bg-sage/40" : "bg-limestone text-ink-soft hover:text-charcoal"}`}>
                  {s.id}
                  <span className="sr-only">: {s.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <ol className="flex items-center gap-1.5" aria-label={`Steps in ${stage.id}`}>
            {phases.map((p, i) => (
              <li key={p.id}>
                <button type="button" onClick={interrupt(() => setPhase(i))} aria-current={i === phase ? "step" : undefined} title={p.label}
                  className={`block h-2.5 rounded-full transition-all duration-300 ${i === phase ? "w-6 bg-charcoal" : i < phase ? "w-2.5 bg-sage-deep" : "w-2.5 bg-oat"}`}>
                  <span className="sr-only">Step {i + 1}: {p.label}</span>
                </button>
              </li>
            ))}
            <li className="ml-2 hidden text-[0.72rem] text-ink-soft sm:block" aria-hidden>{phases[phase]!.label}</li>
          </ol>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Playback">
            <button type="button" className={btn} onClick={reset} data-testid="reset">Reset</button>
            <button type="button" className={btn} onClick={interrupt(() => goStage(stageIdx - 1))} disabled={stageIdx === 0} data-testid="prev-stage">
              <span aria-hidden>«</span><span className="sr-only sm:not-sr-only">Previous stage</span>
            </button>
            <button type="button" className={btn} onClick={interrupt(() => step(-1))} disabled={stageIdx === 0 && phase === 0} data-testid="step-back" aria-label="Step back">
              <span aria-hidden>‹</span>
            </button>
            <button type="button" className="btn btn-primary h-10 px-4 text-[0.8rem]" onClick={() => (atEnd ? (reset(), setPlaying(true)) : setPlaying(!playing))}
              aria-pressed={playing} data-testid="play-toggle">
              {playing ? "Pause" : "Play"}
            </button>
            <button type="button" className={btn} onClick={interrupt(() => step(1))} disabled={atEnd} data-testid="step-forward" aria-label="Step forward">
              <span aria-hidden>›</span>
            </button>
            <button type="button" className={btn} onClick={interrupt(() => goStage(stageIdx + 1))} disabled={stageIdx === STAGES.length - 1} data-testid="next-stage">
              <span className="sr-only sm:not-sr-only">Next stage</span><span aria-hidden>»</span>
            </button>
          </div>
        </div>
        <p className="mt-1 hidden text-[0.68rem] text-ink-soft md:block">Keyboard: ← and → step through the animation. {reduced ? "Reduced motion is on: each stage opens at its final state." : ""}</p>
      </div>
    </div>
  );
}
