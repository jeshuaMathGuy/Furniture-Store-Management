"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { buildModel, type DimsCm } from "@/three/models";
import { assemblyState, assemblySteps, stepCaption } from "@/three/assembly";
import { FurnitureGlyph } from "@/components/furniture-glyph";
import { setRenderPref, useRenderMode } from "@/components/render-mode";
import type { ViewerCommand } from "./viewer-canvas";

// three.js is only downloaded when a 3D view is actually shown.
const ViewerCanvas = dynamic(() => import("./viewer-canvas"), { ssr: false });

export interface ViewerVariant { variantId: number; name: string; material: string; colorHex: string }

export interface FurnitureViewerProps {
  name: string;
  modelKey: string | null;
  dimensions: DimsCm | null;
  material: string | null;
  variant?: ViewerVariant | null;
  className?: string;
}

/**
 * Focus ring for controls drawn over the 3D scene: charcoal (10.6:1 on porcelain)
 * rather than the global brass ring, which is below 3:1 against the light scene.
 */
export const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-charcoal";

function ToolButton({ label, pressed, onClick, children, testId }: { label: string; pressed?: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={pressed} data-testid={testId}
      className={`grid size-9 place-items-center rounded-full text-sm shadow-soft transition-colors ${FOCUS_RING} ${pressed ? "bg-charcoal text-porcelain" : "bg-porcelain/90 text-charcoal hover:bg-white"}`}>
      {children}
    </button>
  );
}

/**
 * Reusable 3D furniture viewer: rotate, zoom, reset, auto-rotate, exploded
 * assembly with a step-by-step sequence, dimensions, fullscreen and keyboard
 * control. It falls back to the 2D elevation drawing without WebGL, on
 * low-power devices, or by user choice.
 */
export function FurnitureViewer({ name, modelKey, dimensions, material, variant, className = "" }: FurnitureViewerProps) {
  const rm = useRenderMode();
  const model = useMemo(() => buildModel(modelKey, dimensions), [modelKey, dimensions]);
  const steps = useMemo(() => assemblySteps(model), [model]);
  const [exploded, setExplodedRaw] = useState(false);
  const [step, setStep] = useState(0);
  const [autoRotate, setAutoRotate] = useState(false);
  const [showDims, setShowDims] = useState(false);
  const [command, setCommand] = useState<ViewerCommand>({ n: 0, kind: "reset" });
  const [ready, setReady] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const uid = useId();
  const afterId = `after-viewer-${uid.replace(/:/g, "")}`;
  const sliderId = `assembly-${uid.replace(/:/g, "")}`;

  const setExploded = (next: boolean) => { setExplodedRaw(next); if (!next) setStep(0); };
  // A different model starts its sequence again.
  const [stepModel, setStepModel] = useState(model);
  if (stepModel !== model) { setStepModel(model); setStep(0); }

  const send = useCallback((kind: ViewerCommand["kind"]) => setCommand((c) => ({ n: c.n + 1, kind })), []);
  const reset = () => { setExploded(false); setAutoRotate(false); send("reset"); };

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen?.().catch(() => undefined);
  };

  const stepBy = (d: number) => setStep((s) => Math.max(0, Math.min(steps.length, s + d)));
  const onKey = (e: React.KeyboardEvent) => {
    const map: Record<string, () => void> = {
      ArrowLeft: () => send("rotate-left"), ArrowRight: () => send("rotate-right"),
      "+": () => send("zoom-in"), "=": () => send("zoom-in"), "-": () => send("zoom-out"),
      r: reset, e: () => setExploded(!exploded), d: () => setShowDims((v) => !v),
      "[": () => exploded && stepBy(-1), "]": () => exploded && stepBy(1),
    };
    const fn = map[e.key];
    if (fn && e.target === e.currentTarget) { e.preventDefault(); fn(); }
  };

  const is3d = rm.ready && rm.mode === "3d";
  const variantLike = useMemo(() => (variant ? { material: variant.material, colorHex: variant.colorHex, name: variant.name } : null), [variant]);
  const assembly = useMemo(() => ({ ...assemblyState(model, steps, step), step }), [model, steps, step]);
  const caption = stepCaption(steps, step);

  return (
    <div ref={box} className={`relative overflow-hidden rounded-3xl bg-limestone ${fullscreen ? "!rounded-none" : ""} ${className}`}
      data-testid="furniture-viewer" data-mode={is3d ? "3d" : "2d"} data-ready={is3d ? String(ready) : "true"}
      data-exploded={String(exploded)} data-assembly-step={exploded ? step : ""} data-variant={variant?.variantId ?? ""} data-model={model.key}>
      {is3d && (
        <a href={`#${afterId}`} className={`sr-only z-20 rounded-full bg-charcoal px-3 py-1.5 text-xs text-porcelain focus:not-sr-only focus:absolute focus:left-3 focus:top-3 ${FOCUS_RING}`}>
          Skip 3D viewer
        </a>
      )}
      <div
        role="img" tabIndex={is3d ? 0 : -1} onKeyDown={is3d ? onKey : undefined}
        aria-label={is3d
          ? `Interactive 3D model of ${name}. Drag or use the arrow keys to rotate, plus and minus to zoom, E to explode, square brackets to step through the assembly, D for dimensions, R to reset.`
          : `Elevation drawing of ${name}`}
        className="absolute inset-0 focus-visible:outline-offset-[-4px] focus-visible:outline-charcoal"
      >
        {is3d ? (
          <>
            {!ready && <FurnitureGlyph modelKey={modelKey} material={material} color={variant?.colorHex} label={name} className="absolute inset-0 h-full w-full animate-pulse p-14 opacity-60" />}
            <ViewerCanvas model={model} productMaterial={material} variant={variantLike} exploded={exploded} assembly={assembly} autoRotate={autoRotate}
              showDims={showDims} command={command} quality={rm.quality} reducedMotion={rm.reducedMotion} onReady={() => setReady(true)} />
          </>
        ) : (
          <FurnitureGlyph modelKey={modelKey} material={material} color={variant?.colorHex} label={name} className="absolute inset-0 h-full w-full p-14" />
        )}
      </div>

      {is3d && (
        <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
          {/* Small screens: the toolbar folds behind one button so it never covers the model. */}
          <button type="button" className={`grid size-9 place-items-center rounded-full bg-porcelain/90 text-charcoal shadow-soft sm:hidden ${FOCUS_RING}`}
            aria-expanded={toolsOpen} aria-controls={`${sliderId}-tools`} aria-label={toolsOpen ? "Hide viewer controls" : "Show viewer controls"}
            data-testid="viewer-tools-toggle" onClick={() => setToolsOpen((v) => !v)}>
            <span aria-hidden>{toolsOpen ? "×" : "⋯"}</span>
          </button>
          <div id={`${sliderId}-tools`} className={`${toolsOpen ? "flex" : "hidden"} flex-col gap-2 sm:flex`} role="toolbar" aria-orientation="vertical" aria-label="3D viewer controls">
            <ToolButton label="Zoom in" onClick={() => send("zoom-in")}>+</ToolButton>
            <ToolButton label="Zoom out" onClick={() => send("zoom-out")}>−</ToolButton>
            <ToolButton label="Auto-rotate" pressed={autoRotate} onClick={() => setAutoRotate((v) => !v)} testId="viewer-rotate">⟳</ToolButton>
            <ToolButton label="Exploded assembly" pressed={exploded} onClick={() => setExploded(!exploded)} testId="viewer-explode">⊹</ToolButton>
            <ToolButton label="Show dimensions" pressed={showDims} onClick={() => setShowDims((v) => !v)} testId="viewer-dims">↔</ToolButton>
            <ToolButton label="Reset view" onClick={reset} testId="viewer-reset">⌂</ToolButton>
            <ToolButton label={fullscreen ? "Exit fullscreen" : "Fullscreen"} pressed={fullscreen} onClick={toggleFullscreen}>⛶</ToolButton>
          </div>
        </div>
      )}

      {is3d && exploded && (
        <div className="absolute left-3 top-3 w-[min(18rem,calc(100%-4.5rem))] rounded-2xl bg-porcelain/95 p-3 text-xs text-charcoal shadow-soft" data-testid="assembly-panel">
          <label htmlFor={sliderId} className="eyebrow block">Assembly sequence</label>
          <p className="mt-1 font-medium" aria-live="polite" data-testid="assembly-step">{caption}</p>
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={() => stepBy(-1)} disabled={step === 0} aria-label="Previous step"
              className={`grid size-7 shrink-0 place-items-center rounded-full border hairline disabled:opacity-40 ${FOCUS_RING}`}>‹</button>
            <input id={sliderId} type="range" min={0} max={steps.length} step={1} value={step} onChange={(e) => setStep(Number(e.target.value))}
              aria-valuetext={caption} data-testid="assembly-slider" className={`h-7 w-full min-w-0 accent-charcoal ${FOCUS_RING}`} />
            <button type="button" onClick={() => stepBy(1)} disabled={step === steps.length} aria-label="Next step"
              className={`grid size-7 shrink-0 place-items-center rounded-full border hairline disabled:opacity-40 ${FOCUS_RING}`}>›</button>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-ink-soft">Illustration of the procedural model, not a manufacturer drawing.</p>
        </div>
      )}

      <div className="absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2 text-[11px] text-ink-soft">
        <p className="max-w-[70%] rounded-full bg-porcelain/85 px-3 py-1">
          {is3d
            ? exploded ? "Exploded view of a procedural model. Parts are illustrative, not manufacturer drawings." : "Procedural 3D model built from this product's recorded dimensions."
            : rm.ready ? `Elevation drawing · ${rm.reason}` : "Elevation drawing"}
        </p>
        {rm.ready && (
          <button type="button" className={`rounded-full bg-porcelain/90 px-3 py-1 text-charcoal hover:bg-white ${FOCUS_RING}`} data-testid="viewer-mode-toggle"
            onClick={() => setRenderPref(is3d ? "2d" : "3d")}>
            {is3d ? "Use 2D view" : "Try 3D view"}
          </button>
        )}
      </div>
      <span id={afterId} tabIndex={-1} className="sr-only">End of 3D viewer</span>
    </div>
  );
}
