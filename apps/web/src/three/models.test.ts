import { describe, expect, it } from "vitest";
import { MODEL_KEYS, buildModel, modelBounds, resolveSlot, shade } from "./models";

/** Catalogue dimensions as seeded in database/seeds/0002_demo_catalog.sql (product_detail). */
const CATALOGUE: [productId: number, key: string, w: number, d: number, h: number][] = [
  [101, "desk", 180, 85, 76], [102, "chair", 62, 60, 98], [201, "sofa", 280, 100, 78], [202, "table", 200, 95, 76],
  [103, "sideboard", 180, 45, 78], [104, "bookcase", 90, 35, 200], [105, "bed", 170, 215, 90],
  [203, "lounge_chair", 82, 80, 74], [204, "coffee_table", 120, 65, 38], [205, "bench", 150, 38, 45],
  [206, "table", 220, 100, 75], [301, "bed", 180, 220, 110], [302, "nightstand", 45, 40, 55],
  [303, "armchair", 78, 82, 96], [304, "chest", 120, 48, 95], [401, "desk", 160, 75, 120],
  [402, "chair", 66, 64, 112], [403, "credenza", 160, 45, 72], [404, "side_table", 45, 45, 120], [405, "shelving", 240, 35, 200],
];

describe("parametric models", () => {
  it("cover every model key used by the catalogue", () => {
    for (const [, key] of CATALOGUE) expect(MODEL_KEYS).toContain(key);
  });

  it.each(CATALOGUE)("product %i (%s) is assembled to its database dimensions within 1 cm", (_id, key, w, d, h) => {
    const m = buildModel(key, { widthCm: w, depthCm: d, heightCm: h });
    const b = modelBounds(m);
    expect(b.max[0] - b.min[0]).toBeCloseTo(w / 100, 2);
    expect(b.max[1] - b.min[1]).toBeCloseTo(h / 100, 2);
    expect(b.max[2] - b.min[2]).toBeCloseTo(d / 100, 2);
    expect(b.min[1]).toBeCloseTo(0, 3); // stands on the floor
    expect(Math.abs(b.min[0] + b.max[0])).toBeLessThan(0.01); // centred on x
  });

  it.each(CATALOGUE)("product %i (%s) has unique part ids, positive sizes and a real exploded state", (_id, key, w, d, h) => {
    const m = buildModel(key, { widthCm: w, depthCm: d, heightCm: h });
    const ids = m.parts.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of m.parts) {
      const dims = p.geo.kind === "box" ? p.geo.size : p.geo.kind === "cylinder" ? [p.geo.radiusTop, p.geo.radiusBottom, p.geo.height] : [p.geo.radius];
      for (const x of dims) expect(x, `${key}.${p.id}`).toBeGreaterThan(0);
    }
    const moving = m.parts.filter((p) => p.explode.some((v) => v !== 0));
    expect(moving.length / m.parts.length).toBeGreaterThanOrEqual(0.6);
  });

  it("falls back to a table for unknown keys and missing dimensions", () => {
    expect(buildModel("spaceship", null).key).toBe("table");
  });
});

describe("material resolution", () => {
  it("oak chair: oak frame, linen seat unless a fabric variant is chosen", () => {
    expect(resolveSlot("frame", "Oak")).toMatchObject({ finish: "wood", color: "#C8A27A" });
    expect(resolveSlot("upholstery", "Oak").finish).toBe("fabric");
    expect(resolveSlot("upholstery", "Oak", { material: "Oak", colorHex: "#A8B09D" }).color).not.toBe("#A8B09D");
  });
  it("a variant's colour follows its name: 'Natural Oak / Sage Fabric' recolours the seat, not the oak", () => {
    const v = { material: "Oak", colorHex: "#A8B09D", name: "Natural Oak / Sage Fabric" };
    expect(resolveSlot("upholstery", "Oak", v)).toMatchObject({ finish: "fabric", color: "#A8B09D" });
    expect(resolveSlot("frame", "Oak", v)).toMatchObject({ finish: "wood", color: "#C8A27A" });
    expect(resolveSlot("surface", "Oak", v).color).toBe("#C8A27A");
  });
  it("fabric sofa: a variant recolours the upholstery and the legs stay dark wood", () => {
    expect(resolveSlot("upholstery", "Fabric", { material: "Velvet", colorHex: "#A8B09D" })).toMatchObject({ finish: "fabric", color: "#A8B09D" });
    expect(resolveSlot("frame", "Fabric").finish).toBe("wood");
  });
  it("wood variant recolours wood surfaces (Smoked Oak desk)", () => {
    expect(resolveSlot("surface", "Oak", { material: "Oak", colorHex: "#6B4E3D" }).color).toBe("#6B4E3D");
  });
  it("stone table stands on brass; steel & oak desk has an oak top and steel frame", () => {
    expect(resolveSlot("frame", "Marble").name).toBe("Brushed brass");
    expect(resolveSlot("surface", "Steel & oak").finish).toBe("wood");
    expect(resolveSlot("frame", "Steel & oak").finish).toBe("metal");
  });
  it("shade lightens and darkens within range", () => {
    expect(shade("#000000", 0.5)).toBe("#808080");
    expect(shade("#ffffff", -0.5)).toBe("#808080");
  });
});
