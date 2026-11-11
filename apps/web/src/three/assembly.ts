/**
 * Assembly sequence for the procedural models (pure: no three.js, no React).
 *
 * Parts that share a label ("Leg", "Arm", "Drawer front") form one step. The
 * order is curated per model key (what a person would fit first), and any
 * label a curated order does not mention is appended in the order derived from
 * the explode vectors: parts that move least when exploded are the structural
 * core and come first, then lower parts before higher ones.
 *
 * This illustrates how THIS procedural model goes together. It is not a
 * manufacturer's assembly drawing, and the UI says so.
 */
import type { FurnitureModel, V3 } from "./models";

/** Curated reassembly order by part label, per model key. */
export const ASSEMBLY_ORDER: Record<string, string[]> = {
  desk: ["Leg", "Desktop", "Drawer pedestal", "Cable tray"],
  chair: ["Leg", "Upholstered seat", "Back rail", "Steam-bent back"],
  sofa: ["Leg", "Upholstered base", "Arm", "Back cushion", "Seat cushion"],
  table: ["Leg", "Apron", "Tabletop"],
  sideboard: ["Leg", "Carcass", "Fluted door"],
  bookcase: ["Side panel", "Adjustable shelf", "Back panel"],
  bed: ["Leg", "Bed frame", "Headboard", "Mattress"],
  lounge_chair: ["Leg", "Upholstered base", "Curved back shell", "Arm", "Seat cushion"],
  coffee_table: ["Split pedestal", "Honed top"],
  bench: ["Leg", "Stretcher", "Seat plank"],
  armchair: ["Leg", "Seat base", "Wingback", "Arm", "Seat cushion"],
  nightstand: ["Leg", "Woven case", "Drawer front"],
  chest: ["Leg", "Carcass", "Drawer front", "Brass pull"],
  credenza: ["Plinth", "Steel carcass", "Filing drawer"],
  side_table: ["Weighted base", "Post", "Table top", "Brass shade", "Dimmable lamp"],
  shelving: ["Wall upright", "Shelf"],
};

export interface AssemblyStep {
  /** 0-based position in the sequence. */
  index: number;
  label: string;
  /** "Leg ×4" or "Upholstered seat". */
  title: string;
  partIds: string[];
}

export type PartRole = "placed" | "current" | "pending";

const mag = (v: V3) => Math.hypot(v[0], v[1], v[2]);

/** Order derived from explode vectors alone (used for labels without a curated position). */
export function derivedOrder(model: FurnitureModel): string[] {
  const groups = new Map<string, { move: number; y: number }>();
  for (const p of model.parts) {
    const g = groups.get(p.label);
    const move = mag(p.explode), y = p.position[1];
    if (!g) groups.set(p.label, { move, y });
    else groups.set(p.label, { move: Math.min(g.move, move), y: Math.min(g.y, y) });
  }
  return [...groups.entries()]
    .sort(([, a], [, b]) => a.move - b.move || a.y - b.y)
    .map(([label]) => label);
}

export function assemblySteps(model: FurnitureModel): AssemblyStep[] {
  const present = new Set(model.parts.map((p) => p.label));
  const curated = (ASSEMBLY_ORDER[model.key] ?? []).filter((l) => present.has(l));
  const order = [...curated, ...derivedOrder(model).filter((l) => !curated.includes(l))];
  return order.map((label, index) => {
    const partIds = model.parts.filter((p) => p.label === label).map((p) => p.id);
    return { index, label, title: partIds.length > 1 ? `${label} ×${partIds.length}` : label, partIds };
  });
}

/**
 * Per-part explode factor and role at a given step.
 * step 0: everything laid out (exploded); step k (1..n): steps 1..k are fitted,
 * step k is the one being fitted now, and the rest wait in their exploded positions.
 */
export function assemblyState(model: FurnitureModel, steps: AssemblyStep[], step: number): { explode: number[]; role: PartRole[] } {
  const k = Math.max(0, Math.min(steps.length, Math.round(step)));
  const stepOf = new Map<string, number>();
  steps.forEach((s) => s.partIds.forEach((id) => stepOf.set(id, s.index)));
  const role = model.parts.map((p): PartRole => {
    const i = stepOf.get(p.id) ?? steps.length;
    if (k === 0) return "pending";
    return i < k - 1 ? "placed" : i === k - 1 ? "current" : "pending";
  });
  return { explode: role.map((r) => (r === "pending" ? 1 : 0)), role };
}

export function stepCaption(steps: AssemblyStep[], step: number): string {
  if (step <= 0) return `All ${steps.length} steps laid out`;
  const s = steps[Math.min(step, steps.length) - 1]!;
  return `Step ${s.index + 1} of ${steps.length}: ${s.title}`;
}

export interface LabelAnchor { label: string; partId: string; anchor: V3; labelPos: V3 }

/**
 * One label per unique part label, with a leader line from the part (at its
 * current explode factor) out to the label, pointing away from the model's centre.
 */
export function labelAnchors(model: FurnitureModel, explode: number[] | number = 1): LabelAnchor[] {
  const { w, d, h } = model.dims;
  const reach = Math.min(0.35, Math.max(0.12, Math.max(w, d, h) * 0.14));
  const seen = new Set<string>();
  const out: LabelAnchor[] = [];
  model.parts.forEach((p, i) => {
    if (seen.has(p.label)) return;
    seen.add(p.label);
    const e = typeof explode === "number" ? explode : explode[i] ?? 0;
    const anchor: V3 = [p.position[0] + p.explode[0] * e, p.position[1] + p.explode[1] * e, p.position[2] + p.explode[2] * e];
    let dx = anchor[0], dz = anchor[2];
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) { dx = 0.7; dz = 0.7; } else { dx /= len; dz /= len; }
    const up = anchor[1] >= h / 2 ? 0.12 : -0.04;
    out.push({ label: p.label, partId: p.id, anchor, labelPos: [anchor[0] + dx * reach, Math.max(0.04, anchor[1] + up), anchor[2] + dz * reach] });
  });
  return out;
}
