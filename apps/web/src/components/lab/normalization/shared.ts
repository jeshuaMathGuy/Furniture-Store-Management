import type { NormalForm, NfViolation, Row } from "@furni/database/src/lab/normalization";

export interface Phase { id: "relations" | "before" | "highlight" | "split" | "rows" | "verified"; label: string }

export const UNF_PHASES: Phase[] = [
  { id: "relations", label: "The unnormalised relations" },
  { id: "highlight", label: "Spot the non-atomic attributes" },
];
export const TRANSITION_PHASES: Phase[] = [
  { id: "before", label: "Starting relations" },
  { id: "highlight", label: "Highlight the violation" },
  { id: "split", label: "Split the schema" },
  { id: "rows", label: "Move the rows" },
  { id: "verified", label: "Verify the reconstruction" },
];
export const phasesFor = (stage: NormalForm) => (stage === "UNF" ? UNF_PHASES : TRANSITION_PHASES);

/** Static class names (Tailwind must see them literally). Decorative fills are always paired with a text label. */
export const TINTS = [
  { cell: "bg-clay/20", head: "bg-clay/25 text-clay-deep", ring: "ring-clay", dot: "bg-clay" },
  { cell: "bg-sage/30", head: "bg-sage/35 text-sage-deep", ring: "ring-sage-deep", dot: "bg-sage-deep" },
  { cell: "bg-brass/25", head: "bg-brass/30 text-walnut", ring: "ring-brass", dot: "bg-brass" },
  { cell: "bg-oat/70", head: "bg-oat text-walnut", ring: "ring-walnut", dot: "bg-walnut" },
] as const;
export const tint = (i: number) => TINTS[((i % TINTS.length) + TINTS.length) % TINTS.length]!;

export type Highlight = { tint: number; role: "determinant" | "dependent" | "nonatomic" };

/** attribute → highlight, for the relation a violation belongs to. */
export function highlightMap(violations: (NfViolation & { relation: string })[], relation: string): Map<string, Highlight> {
  const m = new Map<string, Highlight>();
  violations.forEach((v, i) => {
    if (v.relation !== relation) return;
    if (v.kind === "non-atomic") { for (const a of v.rhs) m.set(a, { tint: i, role: "nonatomic" }); return; }
    for (const a of v.rhs) if (!m.has(a)) m.set(a, { tint: i, role: "dependent" });
    for (const a of v.lhs) if (!m.has(a) || m.get(a)!.role !== "determinant") m.set(a, { tint: i, role: "determinant" });
  });
  return m;
}

export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export const rowGroupKey = (r: Row) => String(r.order_id ?? r.supplier_id ?? "");

export const BASIS_LABEL = { declared: "declared", assumed: "assumed", "observed-in-sample": "observed in sample" } as const;
export const BASIS_CLASS = {
  declared: "bg-charcoal text-porcelain",
  assumed: "bg-brass/25 text-walnut",
  "observed-in-sample": "border border-dashed border-ink-soft/50 text-ink-soft",
} as const;

export const NF_CLASS: Record<NormalForm, string> = {
  UNF: "bg-clay/20 text-clay-deep",
  "1NF": "bg-clay/15 text-clay-deep",
  "2NF": "bg-brass/20 text-walnut",
  "3NF": "bg-oat/70 text-walnut",
  BCNF: "bg-sage/25 text-sage-deep",
  "4NF": "bg-sage/40 text-sage-deep",
};
