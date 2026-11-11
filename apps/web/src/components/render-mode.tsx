"use client";

import { useSyncExternalStore } from "react";

/**
 * Rendering preference: "auto" picks from device capability; "3d" and "2d" are
 * explicit user choices, remembered per browser (a convenience, so storage
 * failures are ignored). Everything also works in 2D.
 */
export type RenderPref = "auto" | "3d" | "2d";
export interface RenderMode {
  ready: boolean;          // false during SSR / first paint, so we render the 2D drawing first
  pref: RenderPref;
  mode: "3d" | "2d";
  quality: "high" | "low";
  reducedMotion: boolean;
  reason: string;
}

const KEY = "furni:render";
const EVENT = "furni:render-change";

function readPref(): RenderPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "3d" || v === "2d" ? v : "auto";
  } catch { return "auto"; }
}

export function setRenderPref(p: RenderPref) {
  try { if (p === "auto") localStorage.removeItem(KEY); else localStorage.setItem(KEY, p); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT));
}

let webgl: boolean | undefined;
function hasWebGL(): boolean {
  if (webgl !== undefined) return webgl;
  try {
    const c = document.createElement("canvas");
    webgl = !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { webgl = false; }
  return webgl;
}

function capability(): { tier: "none" | "low" | "mid" | "high"; why: string } {
  if (!hasWebGL()) return { tier: "none", why: "WebGL is unavailable" };
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const mem = nav.deviceMemory ?? 8, cores = nav.hardwareConcurrency ?? 8;
  if (nav.connection?.saveData) return { tier: "low", why: "data saver is on" };
  if (mem <= 2 || cores <= 2) return { tier: "low", why: "limited device memory or CPU" };
  if (mem <= 4 || cores <= 4) return { tier: "mid", why: "mid-range device" };
  return { tier: "high", why: "capable device" };
}

function subscribe(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  mq.addEventListener("change", cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); mq.removeEventListener("change", cb); };
}

let cached: { key: string; value: RenderMode } | null = null;
function snapshot(): RenderMode {
  const pref = readPref();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const cap = capability();
  const key = `${pref}|${reducedMotion}|${cap.tier}`;
  if (cached?.key === key) return cached.value;
  let mode: "3d" | "2d", quality: "high" | "low", reason: string;
  if (cap.tier === "none") { mode = "2d"; quality = "low"; reason = cap.why; }
  else if (pref === "2d") { mode = "2d"; quality = "low"; reason = "2D chosen in rendering settings"; }
  else if (pref === "3d") { mode = "3d"; quality = cap.tier === "high" ? "high" : "low"; reason = "3D chosen in rendering settings"; }
  else if (cap.tier === "low") { mode = "2d"; quality = "low"; reason = `2D selected automatically: ${cap.why}`; }
  else { mode = "3d"; quality = cap.tier === "high" ? "high" : "low"; reason = `3D (${quality} quality): ${cap.why}`; }
  cached = { key, value: { ready: true, pref, mode, quality, reducedMotion, reason } };
  return cached.value;
}

const SERVER: RenderMode = { ready: false, pref: "auto", mode: "2d", quality: "low", reducedMotion: false, reason: "server render" };

export function useRenderMode(): RenderMode {
  return useSyncExternalStore(subscribe, snapshot, () => SERVER);
}

export function RenderModeControl() {
  const rm = useRenderMode();
  const options: [RenderPref, string][] = [["auto", "Auto"], ["3d", "3D"], ["2d", "2D only"]];
  return (
    <fieldset className="text-sm" data-testid="render-mode-control">
      <legend className="eyebrow mb-3">Rendering</legend>
      <div className="inline-flex rounded-full border hairline p-1">
        {options.map(([value, label]) => (
          <label key={value} className={`cursor-pointer rounded-full px-3 py-1.5 text-xs transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brass ${rm.pref === value ? "bg-charcoal text-porcelain" : "text-ink-soft hover:text-charcoal"}`}>
            <input type="radio" name="render-pref" value={value} checked={rm.pref === value} onChange={() => setRenderPref(value)} className="sr-only" />
            {label}
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-soft" aria-live="polite">{rm.ready ? rm.reason : ""}</p>
    </fieldset>
  );
}
