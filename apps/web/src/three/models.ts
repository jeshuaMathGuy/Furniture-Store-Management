/**
 * Parametric furniture models (pure data: no three.js, no React).
 *
 * No licensed GLB assets exist yet, so each catalogue `model_key` is generated
 * from named parts sized by the product's real database dimensions. Each part
 * carries an explode vector, so the exploded view shows how THIS procedural
 * model is assembled. It is an illustration, not manufacturer CAD data, and
 * the UI labels it that way.
 *
 * Units: metres. Y is up, the floor is y = 0, and the model is centred on x/z.
 */
export type V3 = [number, number, number];
export type Slot = "frame" | "surface" | "upholstery" | "cushion" | "metal" | "accent";

export type Geo =
  | { kind: "box"; size: V3; radius?: number }
  | { kind: "cylinder"; radiusTop: number; radiusBottom: number; height: number; segments?: number }
  | { kind: "sphere"; radius: number; scale?: V3 };

export interface Part {
  id: string;
  label: string;
  geo: Geo;
  position: V3;
  slot: Slot;
  /** Displacement applied when fully exploded. */
  explode: V3;
}

export interface FurnitureModel {
  key: string;
  dims: { w: number; d: number; h: number };
  parts: Part[];
  procedural: true;
}

export interface DimsCm { widthCm: number; depthCm: number; heightCm: number }

type Builder = (w: number, d: number, h: number) => Part[];

const box = (id: string, label: string, size: V3, position: V3, slot: Slot, explode: V3, radius = 0): Part =>
  ({ id, label, geo: { kind: "box", size, radius: radius || undefined }, position, slot, explode });

const cyl = (id: string, label: string, rTop: number, rBottom: number, height: number, position: V3, slot: Slot, explode: V3): Part =>
  ({ id, label, geo: { kind: "cylinder", radiusTop: rTop, radiusBottom: rBottom, height }, position, slot, explode });

const CORNERS: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

/** Four legs at the corners of a w×d footprint, inset by `inset`, from the floor up to `top`. */
function legs(w: number, d: number, top: number, opts: { inset?: number; size?: number; round?: boolean; taper?: number; slot?: Slot; spread?: number } = {}): Part[] {
  const { inset = 0.04, size = 0.045, round = false, taper = 1, slot = "frame", spread = 0.22 } = opts;
  return CORNERS.map(([sx, sz], i) => {
    const pos: V3 = [sx * (w / 2 - inset), top / 2, sz * (d / 2 - inset)];
    const ex: V3 = [sx * spread, -0.06, sz * spread];
    return round
      ? cyl(`leg-${i + 1}`, "Leg", size / 2, (size / 2) * taper, top, pos, slot, ex)
      : box(`leg-${i + 1}`, "Leg", [size, top, size], pos, slot, ex);
  });
}

const BUILDERS: Record<string, Builder> = {
  desk: (w, d, h) => {
    const t = 0.035;
    const parts = [box("top", "Desktop", [w, t, d], [0, h - t / 2, 0], "surface", [0, 0.35, 0], 0.006), ...legs(w, d, h - t, { size: 0.05 })];
    if (w >= 1.2) parts.push(box("pedestal", "Drawer pedestal", [0.4, h * 0.38, d * 0.85], [w / 2 - 0.3, h - t - h * 0.19, 0], "surface", [0.12, -0.28, 0.1], 0.004));
    parts.push(box("cable-tray", "Cable tray", [w * 0.5, 0.02, 0.1], [-w * 0.1, h - t - 0.05, -d / 2 + 0.1], "metal", [0, -0.18, -0.15]));
    return parts;
  },

  chair: (w, d, h) => {
    const seatH = 0.46, t = 0.05, backT = 0.035;
    const bh = h - seatH - 0.04;
    return [
      box("seat", "Upholstered seat", [w, t, d - backT], [0, seatH, backT / 2], "upholstery", [0, 0.22, 0.05], 0.015),
      ...legs(w * 0.88, d * 0.82, seatH - t / 2, { round: true, size: 0.036, taper: 0.7, spread: 0.18 }),
      box("back", "Steam-bent back", [w * 0.86, bh, backT], [0, seatH + 0.04 + bh / 2, -d / 2 + backT / 2], "surface", [0, 0.12, -0.32], 0.012),
      box("back-rail", "Back rail", [w * 0.8, 0.03, 0.03], [0, seatH + 0.06, -d / 2 + 0.06], "frame", [0, 0.06, -0.18]),
    ];
  },

  sofa: (w, d, h) => {
    const legH = 0.12, baseH = 0.22, arm = 0.2;
    const inner = w - 2 * arm;
    const n = w > 2.2 ? 3 : 2;
    const cw = inner / n;
    const baseTop = legH + baseH;
    const backD = 0.24;
    const seatD = d - backD;
    const cushions = Array.from({ length: n }, (_, i) =>
      box(`seat-${i + 1}`, "Seat cushion", [cw - 0.01, 0.16, seatD - 0.02], [-inner / 2 + cw * (i + 0.5), baseTop + 0.08, d / 2 - seatD / 2], "cushion",
        [(i - (n - 1) / 2) * 0.18, 0.32, 0.12], 0.045));
    return [
      box("base", "Upholstered base", [inner, baseH, d], [0, legH + baseH / 2, 0], "upholstery", [0, 0, 0], 0.03),
      ...cushions,
      box("back", "Back cushion", [inner, h - baseTop, backD], [0, baseTop + (h - baseTop) / 2, -d / 2 + backD / 2], "upholstery", [0, 0.12, -0.35], 0.05),
      box("arm-l", "Arm", [arm, h * 0.78 - legH, d], [-w / 2 + arm / 2, legH + (h * 0.78 - legH) / 2, 0], "upholstery", [-0.35, 0, 0], 0.05),
      box("arm-r", "Arm", [arm, h * 0.78 - legH, d], [w / 2 - arm / 2, legH + (h * 0.78 - legH) / 2, 0], "upholstery", [0.35, 0, 0], 0.05),
      ...legs(w, d, legH, { round: true, size: 0.04, inset: 0.08, spread: 0.1 }),
    ];
  },

  table: (w, d, h) => {
    const t = 0.045;
    return [
      box("top", "Tabletop", [w, t, d], [0, h - t / 2, 0], "surface", [0, 0.4, 0], 0.008),
      box("apron-f", "Apron", [w - 0.24, 0.08, 0.025], [0, h - t - 0.04, d / 2 - 0.1], "frame", [0, 0.12, 0.2]),
      box("apron-b", "Apron", [w - 0.24, 0.08, 0.025], [0, h - t - 0.04, -d / 2 + 0.1], "frame", [0, 0.12, -0.2]),
      ...legs(w, d, h - t, { inset: 0.08, size: 0.07, spread: 0.28 }),
    ];
  },

  sideboard: (w, d, h) => {
    const legH = 0.14, bodyH = h - legH, n = w >= 1.5 ? 4 : 2, dw = w / n;
    return [
      box("body", "Carcass", [w, bodyH, d - 0.015], [0, legH + bodyH / 2, -0.0075], "surface", [0, 0, -0.1], 0.005),
      ...Array.from({ length: n }, (_, i) => box(`door-${i + 1}`, "Fluted door", [dw - 0.008, bodyH - 0.03, 0.015], [-w / 2 + dw * (i + 0.5), legH + bodyH / 2, d / 2 - 0.0075], "accent", [0, 0, 0.28 + (i % 2) * 0.06])),
      ...legs(w - 0.1, d - 0.08, legH, { round: true, size: 0.04, taper: 0.55, spread: 0.12 }),
    ];
  },

  bookcase: (w, d, h) => {
    const t = 0.025, n = 5;
    const shelves = Array.from({ length: n }, (_, i) => box(`shelf-${i + 1}`, "Adjustable shelf", [w - 2 * t, t, d - 0.01], [0, t / 2 + (i * (h - t)) / (n - 1), 0.005], "surface", [0, 0, 0.18 + i * 0.03]));
    return [
      box("side-l", "Side panel", [t, h, d], [-w / 2 + t / 2, h / 2, 0], "surface", [-0.25, 0, 0]),
      box("side-r", "Side panel", [t, h, d], [w / 2 - t / 2, h / 2, 0], "surface", [0.25, 0, 0]),
      box("back", "Back panel", [w - 2 * t, h, 0.008], [0, h / 2, -d / 2 + 0.004], "accent", [0, 0, -0.25]),
      ...shelves,
    ];
  },

  bed: (w, d, h) => {
    const legH = 0.08, frameH = 0.24, headT = 0.08;
    const top = legH + frameH;
    return [
      box("frame", "Bed frame", [w, frameH, d - headT], [0, legH + frameH / 2, headT / 2], "surface", [0, 0, 0.15], 0.01),
      box("mattress", "Mattress", [w - 0.06, 0.2, d - headT - 0.05], [0, top + 0.1, headT / 2], "cushion", [0, 0.38, 0.05], 0.05),
      box("headboard", "Headboard", [w, h, headT], [0, h / 2, -d / 2 + headT / 2], "surface", [0, 0.08, -0.35], 0.02),
      ...legs(w - 0.1, d - headT - 0.1, legH, { size: 0.06, spread: 0.12 }).map((p) => ({ ...p, position: [p.position[0], p.position[1], p.position[2] + headT / 2] as V3 })),
    ];
  },

  lounge_chair: (w, d, h) => {
    const legH = 0.06, seatTop = 0.4;
    return [
      box("base", "Upholstered base", [w, seatTop - legH - 0.1, d], [0, legH + (seatTop - legH - 0.1) / 2, 0], "upholstery", [0, 0, 0], 0.09),
      box("seat", "Seat cushion", [w - 0.16, 0.12, d - 0.2], [0, seatTop - 0.06, 0.05], "cushion", [0, 0.28, 0.12], 0.05),
      box("shell", "Curved back shell", [w, h - legH, 0.2], [0, legH + (h - legH) / 2, -d / 2 + 0.1], "upholstery", [0, 0.1, -0.3], 0.1),
      box("arm-l", "Arm", [0.14, h * 0.7 - legH, d - 0.2], [-w / 2 + 0.07, legH + (h * 0.7 - legH) / 2, 0.1], "upholstery", [-0.28, 0, 0], 0.07),
      box("arm-r", "Arm", [0.14, h * 0.7 - legH, d - 0.2], [w / 2 - 0.07, legH + (h * 0.7 - legH) / 2, 0.1], "upholstery", [0.28, 0, 0], 0.07),
      ...legs(w - 0.1, d - 0.1, legH, { round: true, size: 0.035, spread: 0.08 }),
    ];
  },

  coffee_table: (w, d, h) => {
    const t = 0.06, pw = w * 0.22, pd = d * 0.6;
    return [
      box("top", "Honed top", [w, t, d], [0, h - t / 2, 0], "surface", [0, 0.3, 0], 0.02),
      box("pedestal-l", "Split pedestal", [pw, h - t, pd], [-w * 0.25, (h - t) / 2, 0], "surface", [-0.25, -0.02, 0], 0.01),
      box("pedestal-r", "Split pedestal", [pw, h - t, pd], [w * 0.25, (h - t) / 2, 0], "surface", [0.25, -0.02, 0], 0.01),
    ];
  },

  bench: (w, d, h) => {
    const t = 0.05;
    return [
      box("seat", "Seat plank", [w, t, d], [0, h - t / 2, 0], "surface", [0, 0.25, 0], 0.006),
      box("stretcher", "Stretcher", [w - 0.2, 0.04, 0.04], [0, 0.12, 0], "frame", [0, -0.12, 0.18]),
      ...legs(w, d, h - t, { inset: 0.08, size: 0.05, spread: 0.2 }),
    ];
  },

  armchair: (w, d, h) => {
    const legH = 0.14, seatTop = 0.46, arm = 0.13;
    return [
      box("base", "Seat base", [w, seatTop - legH - 0.1, d], [0, legH + (seatTop - legH - 0.1) / 2, 0], "upholstery", [0, 0, 0], 0.03),
      box("seat", "Seat cushion", [w - 2 * arm, 0.12, d - 0.18], [0, seatTop - 0.05, 0.06], "cushion", [0, 0.3, 0.12], 0.04),
      box("back", "Wingback", [w, h - legH, 0.16], [0, legH + (h - legH) / 2, -d / 2 + 0.08], "upholstery", [0, 0.1, -0.3], 0.04),
      box("arm-l", "Arm", [arm, 0.66 - legH, d - 0.16], [-w / 2 + arm / 2, legH + (0.66 - legH) / 2, 0.08], "upholstery", [-0.28, 0, 0], 0.04),
      box("arm-r", "Arm", [arm, 0.66 - legH, d - 0.16], [w / 2 - arm / 2, legH + (0.66 - legH) / 2, 0.08], "upholstery", [0.28, 0, 0], 0.04),
      ...legs(w - 0.06, d - 0.06, legH, { round: true, size: 0.04, taper: 0.6, spread: 0.12 }),
    ];
  },

  nightstand: (w, d, h) => {
    const legH = 0.16, bodyH = h - legH;
    return [
      box("body", "Woven case", [w, bodyH, d], [0, legH + bodyH / 2, 0], "surface", [0, 0.1, -0.08], 0.01),
      box("drawer", "Drawer front", [w - 0.04, bodyH * 0.3, 0.015], [0, h - bodyH * 0.2, d / 2 + 0.0075 - 0.015], "accent", [0, 0, 0.25]),
      ...legs(w, d, legH, { inset: 0.03, size: 0.03, spread: 0.12 }),
    ];
  },

  chest: (w, d, h) => {
    const legH = 0.08, bodyH = h - legH, n = 3, dh = bodyH / n;
    const fronts = Array.from({ length: n }, (_, i) => box(`drawer-${i + 1}`, "Drawer front", [w - 0.03, dh - 0.012, 0.018], [0, legH + dh * (i + 0.5), d / 2 - 0.009], "accent", [0, 0, 0.22 + i * 0.08]));
    const pulls = Array.from({ length: n }, (_, i) => box(`pull-${i + 1}`, "Brass pull", [0.12, 0.012, 0.02], [0, legH + dh * (i + 0.5) + dh * 0.25, d / 2 - 0.01], "metal", [0, 0, 0.32 + i * 0.08]));
    return [
      box("carcass", "Carcass", [w, bodyH, d - 0.018], [0, legH + bodyH / 2, -0.009], "surface", [0, 0, -0.12], 0.004),
      ...fronts, ...pulls,
      ...legs(w - 0.04, d - 0.06, legH, { size: 0.05, spread: 0.1 }),
    ];
  },

  credenza: (w, d, h) => {
    const plinth = 0.06, bodyH = h - plinth;
    return [
      box("body", "Steel carcass", [w, bodyH, d - 0.015], [0, plinth + bodyH / 2, -0.0075], "surface", [0, 0.05, -0.08], 0.004),
      box("door-l", "Filing drawer", [w / 2 - 0.006, bodyH - 0.02, 0.015], [-w / 4, plinth + bodyH / 2, d / 2 - 0.0075], "accent", [-0.08, 0, 0.26]),
      box("door-r", "Filing drawer", [w / 2 - 0.006, bodyH - 0.02, 0.015], [w / 4, plinth + bodyH / 2, d / 2 - 0.0075], "accent", [0.08, 0, 0.26]),
      box("plinth", "Plinth", [w - 0.06, plinth, d - 0.06], [0, plinth / 2, 0], "frame", [0, -0.12, 0]),
    ];
  },

  side_table: (w, _d, h) => {
    const topY = 0.56, r = w / 2;
    return [
      cyl("base", "Weighted base", r * 0.8, r * 0.85, 0.025, [0, 0.0125, 0], "frame", [0, -0.12, 0]),
      cyl("post", "Post", 0.014, 0.014, h - 0.2, [0, (h - 0.2) / 2, 0], "metal", [0, 0, 0]),
      cyl("top", "Table top", r, r, 0.03, [0, topY, 0], "surface", [0.25, 0.05, 0]),
      cyl("shade", "Brass shade", 0.05, 0.13, 0.16, [0, h - 0.08, 0], "metal", [0, 0.25, 0]),
      { id: "bulb", label: "Dimmable lamp", geo: { kind: "sphere", radius: 0.03 }, position: [0, h - 0.13, 0], slot: "accent", explode: [0, 0.12, 0.12] },
    ];
  },

  shelving: (w, d, h) => {
    const n = 4, t = 0.025, up = 0.03;
    const uprights = [-1, 0, 1].map((k, i) => box(`upright-${i + 1}`, "Wall upright", [up, h, 0.02], [k * (w / 2 - up / 2), h / 2, -d / 2 + 0.01], "metal", [k * 0.2, 0, -0.12]));
    const shelves = Array.from({ length: n }, (_, i) => box(`shelf-${i + 1}`, "Shelf", [w, t, d - 0.02], [0, 0.3 + (i * (h - 0.4)) / (n - 1), 0.01], "surface", [0, 0, 0.16 + i * 0.04]));
    return [...uprights, ...shelves];
  },
};

export const MODEL_KEYS = Object.keys(BUILDERS);

export function buildModel(key: string | null | undefined, dims: DimsCm | null): FurnitureModel {
  const k = key && BUILDERS[key] ? key : "table";
  const w = (dims?.widthCm ?? 120) / 100, d = (dims?.depthCm ?? 60) / 100, h = (dims?.heightCm ?? 75) / 100;
  return { key: k, dims: { w, d, h }, parts: BUILDERS[k]!(w, d, h), procedural: true };
}

/** Axis-aligned bounds of the assembled model (parts are never rotated, so this is exact). */
export function modelBounds(model: FurnitureModel): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of model.parts) {
    const half: V3 =
      p.geo.kind === "box" ? [p.geo.size[0] / 2, p.geo.size[1] / 2, p.geo.size[2] / 2]
      : p.geo.kind === "cylinder" ? [Math.max(p.geo.radiusTop, p.geo.radiusBottom), p.geo.height / 2, Math.max(p.geo.radiusTop, p.geo.radiusBottom)]
      : [p.geo.radius * (p.geo.scale?.[0] ?? 1), p.geo.radius * (p.geo.scale?.[1] ?? 1), p.geo.radius * (p.geo.scale?.[2] ?? 1)];
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, p.position[i]! - half[i]!);
      max[i] = Math.max(max[i]!, p.position[i]! + half[i]!);
    }
  }
  return { min, max };
}

// ---------------------------------------------------------------- material resolution

export type Finish = "wood" | "fabric" | "metal" | "stone" | "rattan" | "mesh";
export interface SlotSpec { finish: Finish; color: string; name: string }

const WOOD: Record<string, string> = { oak: "#C8A27A", walnut: "#6B4E3D", cedar: "#B5835A", ash: "#D8C3A0", sheesham: "#8C5A3C", "solid wood": "#A9784F", acacia: "#A9784F" };
const SOFT: Record<string, string> = { fabric: "#D9C7B5", linen: "#E3D8C6", wool: "#A8B09D", "bouclé": "#EFE9DE", velvet: "#A8B09D" };
const STONE: Record<string, string> = { travertine: "#E2D3BC", marble: "#ECE7DF" };
const METAL: Record<string, string> = { steel: "#7D807A", aluminium: "#B9BCB6" };

function classify(material: string | null | undefined): { finish: Finish; color: string; name: string } {
  const m = (material ?? "").toLowerCase().trim();
  if (m === "steel & oak") return { finish: "metal", color: METAL.steel!, name: "Powder-coated steel" };
  if (WOOD[m]) return { finish: "wood", color: WOOD[m]!, name: titled(m) };
  if (SOFT[m]) return { finish: "fabric", color: SOFT[m]!, name: titled(m) };
  if (STONE[m]) return { finish: "stone", color: STONE[m]!, name: titled(m) };
  if (METAL[m]) return { finish: "metal", color: METAL[m]!, name: titled(m) };
  if (m === "rattan") return { finish: "rattan", color: "#C9A86E", name: "Rattan" };
  if (m === "mesh") return { finish: "mesh", color: "#4A4D46", name: "Mesh" };
  return { finish: "wood", color: WOOD.oak!, name: "Oak" };
}
const titled = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

const SOFT_WORDS = /\b(fabric|weave|velvet|boucl[eé]|linen|wool|mesh)\b/i;

/**
 * A variant's colour belongs to whatever its name says. "Natural Oak / Sage Fabric"
 * is stored with material = Oak, but the colour is the fabric's, so the name wins
 * over the material column when it names a soft finish.
 */
export function variantSpec(variant: { material: string; colorHex: string; name?: string }): SlotSpec {
  const named = variant.name?.match(SOFT_WORDS);
  if (named) {
    const word = named[1]!.toLowerCase();
    return { finish: word === "mesh" ? "mesh" : "fabric", color: variant.colorHex, name: variant.name! };
  }
  return { ...classify(variant.material), color: variant.colorHex, name: variant.name ?? variant.material };
}

const BRASS: SlotSpec = { finish: "metal", color: "#B08D57", name: "Brushed brass" };
const DARK_WOOD: SlotSpec = { finish: "wood", color: "#5A4334", name: "Smoked oak" };
const LINEN: SlotSpec = { finish: "fabric", color: "#EAE2D4", name: "Natural linen" };

/**
 * Resolve what a slot is made of, from the product's primary material and an optional variant.
 * Pure, so it can be unit-tested and shared by every 3D view.
 */
export function resolveSlot(slot: Slot, productMaterial: string | null | undefined, variant?: { material: string; colorHex: string; name?: string } | null): SlotSpec {
  const base = classify(productMaterial);
  const v = variant ? variantSpec(variant) : null;
  const soft = base.finish === "fabric" || base.finish === "mesh";
  const oakTop = (productMaterial ?? "").toLowerCase() === "steel & oak";

  switch (slot) {
    case "surface":
      if (oakTop) return { finish: "wood", color: WOOD.oak!, name: "Oak veneer" };
      if (v && v.finish === base.finish) return v;
      return base;
    case "accent":
      if (v && v.finish === base.finish && !soft) return v;
      return base.finish === "fabric" ? base : { ...base, color: shade(base.color, base.finish === "wood" ? -0.06 : 0.04) };
    case "upholstery":
      if (v && (v.finish === "fabric" || v.finish === "mesh")) return v;
      return soft ? base : LINEN;
    case "cushion":
      if (v && (v.finish === "fabric" || v.finish === "mesh") && soft) return { ...v, color: shade(v.color, 0.05) };
      if (v && (v.finish === "fabric" || v.finish === "mesh")) return v;
      return soft ? { ...base, color: shade(base.color, 0.05) } : LINEN;
    case "frame":
      if (oakTop) return { finish: "metal", color: METAL.steel!, name: "Powder-coated steel" };
      if (base.finish === "wood" || base.finish === "metal") return v && v.finish === base.finish ? v : base;
      if (base.finish === "stone") return BRASS;
      return DARK_WOOD;
    case "metal":
      return base.finish === "metal" && !oakTop ? base : BRASS;
  }
}

/** Lighten (+) or darken (−) a hex colour. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(Math.min(255, Math.max(0, amount >= 0 ? c + (255 - c) * amount : c * (1 + amount)))));
  return "#" + ch.map((c) => c.toString(16).padStart(2, "0")).join("");
}
