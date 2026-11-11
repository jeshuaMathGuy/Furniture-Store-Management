import { describe, expect, it } from "vitest";
import { MODEL_KEYS, buildModel } from "./models";
import { ASSEMBLY_ORDER, assemblyState, assemblySteps, derivedOrder, labelAnchors, stepCaption } from "./assembly";

const SIZES: Record<string, [number, number, number]> = {
  desk: [180, 85, 76], chair: [62, 60, 98], sofa: [280, 100, 78], table: [200, 95, 76], sideboard: [180, 45, 78],
  bookcase: [90, 35, 200], bed: [170, 215, 90], lounge_chair: [82, 80, 74], coffee_table: [120, 65, 38], bench: [150, 38, 45],
  armchair: [78, 82, 96], nightstand: [45, 40, 55], chest: [120, 48, 95], credenza: [160, 45, 72], side_table: [45, 45, 120], shelving: [240, 35, 200],
};
const model = (key: string) => { const [w, d, h] = SIZES[key]!; return buildModel(key, { widthCm: w, depthCm: d, heightCm: h }); };

describe("assembly sequence", () => {
  it("has a curated order for every model key, naming only labels the model really has", () => {
    for (const key of MODEL_KEYS) {
      expect(ASSEMBLY_ORDER[key], key).toBeDefined();
      const labels = new Set(model(key).parts.map((p) => p.label));
      for (const l of ASSEMBLY_ORDER[key]!) expect(labels.has(l), `${key}: ${l}`).toBe(true);
    }
  });

  it.each(Object.keys(SIZES))("%s: every part appears in exactly one step", (key) => {
    const m = model(key);
    const steps = assemblySteps(m);
    const ids = steps.flatMap((s) => s.partIds);
    expect(ids.sort()).toEqual(m.parts.map((p) => p.id).sort());
    expect(steps.length).toBeGreaterThanOrEqual(2);
    steps.forEach((s, i) => expect(s.index).toBe(i));
  });

  it("chair: legs first, then the seat; repeated parts are counted in the title", () => {
    const steps = assemblySteps(model("chair"));
    expect(steps.map((s) => s.title)).toEqual(["Leg ×4", "Upholstered seat", "Back rail", "Steam-bent back"]);
    expect(stepCaption(steps, 2)).toBe("Step 2 of 4: Upholstered seat");
    expect(stepCaption(steps, 0)).toBe("All 4 steps laid out");
  });

  it("small desk without a pedestal skips that step", () => {
    const m = buildModel("desk", { widthCm: 100, depthCm: 60, heightCm: 75 });
    expect(assemblySteps(m).map((s) => s.label)).toEqual(["Leg", "Desktop", "Cable tray"]);
  });

  it("derived order puts parts that barely move (the core) before parts that fly furthest", () => {
    const m = model("sofa");
    const order = derivedOrder(m);
    expect(order[0]).toBe("Upholstered base"); // explode vector is zero
    const unknown = { ...m, key: "not-curated" };
    expect(assemblySteps(unknown).map((s) => s.label)).toEqual(order);
  });

  it("state: fitted steps sit in place, the current one is highlighted, the rest wait exploded", () => {
    const m = model("chair");
    const steps = assemblySteps(m);
    const all = assemblyState(m, steps, 0);
    expect(all.role.every((r) => r === "pending")).toBe(true);
    expect(all.explode.every((e) => e === 1)).toBe(true);

    const s2 = assemblyState(m, steps, 2);
    const roleOf = (id: string) => s2.role[m.parts.findIndex((p) => p.id === id)];
    expect(roleOf("leg-1")).toBe("placed");
    expect(roleOf("seat")).toBe("current");
    expect(roleOf("back")).toBe("pending");
    expect(s2.explode[m.parts.findIndex((p) => p.id === "seat")]).toBe(0);
    expect(s2.explode[m.parts.findIndex((p) => p.id === "back")]).toBe(1);

    const done = assemblyState(m, steps, steps.length);
    expect(done.explode.every((e) => e === 0)).toBe(true);
    expect(assemblyState(m, steps, 99).role).toEqual(done.role); // clamped
  });

  it("labels: one per unique part label, anchored on the exploded part, with a real leader line", () => {
    const m = model("chest");
    const labels = labelAnchors(m, 1);
    expect(labels.map((l) => l.label).sort()).toEqual([...new Set(m.parts.map((p) => p.label))].sort());
    for (const l of labels) {
      const p = m.parts.find((x) => x.id === l.partId)!;
      expect(l.anchor).toEqual([0, 1, 2].map((i) => p.position[i]! + p.explode[i]!));
      expect(Math.hypot(l.labelPos[0] - l.anchor[0], l.labelPos[1] - l.anchor[1], l.labelPos[2] - l.anchor[2])).toBeGreaterThan(0.05);
    }
    // Assembled anchors sit on the part itself.
    const placed = labelAnchors(m, 0).find((l) => l.partId === "carcass")!;
    expect(placed.anchor).toEqual(m.parts.find((p) => p.id === "carcass")!.position);
  });
});
