import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Pool } from "../../packages/database/src/connection.js";
import {
  DECOMPOSITIONS, DEPENDENCIES, EVIDENCE_DISCLAIMER, RELATIONS, STAGES,
  analyzeRelation, bcnfCounterexample, candidateKeys, chase, closure, decomposition, fdViolations, implies,
  loadSample, mvdViolations, preservation, reconstruct, simulateF2, structuralProof, verifyAll, verifyStage,
  type NormalizationLabData, type Sample,
} from "../../packages/database/src/lab/normalization.js";
import { testCfg } from "./helpers.js";

/**
 * Stage 5: the Normalization Laboratory module.
 * Structural results (closure, keys, chase, preservation) are pure; instance checks run on the
 * teaching snapshot as lab_reader, the same SELECT-only user the web page uses.
 */
const cfg = testCfg();
let pool: Pool;
let data: NormalizationLabData;
let sample: Sample;

beforeAll(async () => {
  pool = createPool(cfg, "lab_reader", cfg.TEACHING_DB_NAME, 5);
  data = await verifyAll(pool);
  sample = data.sample;
});
afterAll(async () => { await pool?.end(); });

const set = (xs: string[][]) => xs.map((k) => [...k].sort().join(",")).sort();
const clone = (s: Sample): Sample => JSON.parse(JSON.stringify(s)) as Sample;

describe("attribute closure and candidate keys (pure)", () => {
  const F = [
    { lhs: ["A"], rhs: ["B"] },
    { lhs: ["B"], rhs: ["C"] },
    { lhs: ["C", "D"], rhs: ["E"] },
  ];
  it("computes X⁺ by fixed point", () => {
    expect(closure(["A"], F).sort()).toEqual(["A", "B", "C"]);
    expect(closure(["A", "D"], F).sort()).toEqual(["A", "B", "C", "D", "E"]);
    expect(implies(F, ["A", "D"], ["E"])).toBe(true);
    expect(implies(F, ["B"], ["A"])).toBe(false);
  });
  it("derives all candidate keys, including overlapping ones", () => {
    expect(set(candidateKeys(["A", "B", "C", "D", "E"], F))).toEqual(["A,D"]);
    // R(order, supplier, plan): (order, supplier) → plan, plan → supplier ⇒ two keys
    expect(set(candidateKeys(["o", "s", "p"], [{ lhs: ["o", "s"], rhs: ["p"] }, { lhs: ["p"], rhs: ["s"] }]))).toEqual(["o,p", "o,s"]);
    // no FDs ⇒ the whole heading is the only key
    expect(set(candidateKeys(["x", "y"], []))).toEqual(["x,y"]);
  });
  it("derived keys equal the keys declared in the source DDL for all 22 relations", () => {
    for (const r of Object.values(RELATIONS)) {
      const a = analyzeRelation(r, DEPENDENCIES);
      expect(a.declaredKeysMatch, `${r.name}: derived ${JSON.stringify(a.keys)} vs declared ${JSON.stringify(r.declaredKeys)}`).toBe(true);
    }
    expect(Object.keys(RELATIONS)).toHaveLength(22);
  });
  it("observed-in-sample dependencies never enter the design: order_id → plan_code is not a 2NF violation", () => {
    const a = analyzeRelation(RELATIONS.nf2_order_line!, DEPENDENCIES);
    expect(a.violations.some((v) => v.lhs.join() === "order_id")).toBe(false);
    expect(DEPENDENCIES.some((d) => d.relation === "nf2_order_line" && d.basis === "observed-in-sample")).toBe(true);
  });
});

describe("computed normal forms follow the source's stages", () => {
  const nf = (name: string) => analyzeRelation(RELATIONS[name]!, DEPENDENCIES).highest;
  it("each decomposed relation is exactly one form short of its target", () => {
    expect(nf("unf_sales_order")).toBe("UNF");
    expect(nf("unf_supplier")).toBe("UNF");
    expect(nf("nf1_order_line")).toBe("1NF");
    expect(nf("nf2_order")).toBe("2NF");
    expect(nf("nf2_product")).toBe("2NF");
    expect(nf("nf2_order_line")).toBe("2NF");
    expect(nf("nf3_order_supplier_plan")).toBe("3NF");
    expect(nf("nf3_supplier_capability")).toBe("BCNF");
  });
  it("every relation of the final schema is in 4NF", () => {
    for (const r of STAGES[5]!.relations) expect(nf(r), r).toBe("4NF");
  });
  it("each decomposition removes a violation of its target normal form", () => {
    for (const d of DECOMPOSITIONS) expect(structuralProof(d).removes.length, d.id).toBeGreaterThan(0);
  });
});

describe("structural proofs (hold for every legal instance)", () => {
  it("every projection decomposition is lossless by the chase", () => {
    for (const d of DECOMPOSITIONS.filter((x) => x.method === "projection")) {
      const p = structuralProof(d);
      expect(p.claim).toBe("proof");
      expect(p.lossless, d.id).toBe(true);
      expect(p.chase!.holds, d.id).toBe(true);
      expect(p.binarySteps.every((s) => s.determines !== null), d.id).toBe(true);
    }
  });
  it("BCNF: R₁ ∩ R₂ = {plan_code} → R₂, and (order_id, supplier_id) → plan_code is NOT preserved (F16)", () => {
    const p = structuralProof(decomposition("bcnf-plan"));
    expect(p.method).toBe("binary");
    expect(p.binarySteps[0]!.common).toEqual(["plan_code"]);
    expect(p.binarySteps[0]!.determines).toBe("right");
    expect(p.binarySteps[0]!.notation).toBe("R₁ ∩ R₂ = plan_code → R₂");
    const lost = p.preservation.items.filter((i) => !i.preserved);
    expect(lost.map((i) => `${i.lhs.join(",")}->${i.rhs.join(",")}`)).toEqual(["order_id,supplier_id->plan_code"]);
    expect(p.preservation.preserved).toBe(false);
  });
  it("4NF: lossless by the MVD criterion (Fagin), not by any FD", () => {
    const p = structuralProof(decomposition("4nf-capability"));
    expect(p.binarySteps[0]!.determines).toBe("mvd");
    expect(p.lossless).toBe(true);
    expect(p.preservation.items).toHaveLength(0);
  });
  it("3NF preserves every FD; 2NF does not preserve plan_code → supplier_id until 3NF restores it", () => {
    for (const id of ["3nf-order", "3nf-product", "3nf-order-line"]) expect(structuralProof(decomposition(id)).preservation.preserved, id).toBe(true);
    const twoNf = structuralProof(decomposition("2nf-order-line")).preservation.items.filter((i) => !i.preserved);
    expect(twoNf.map((i) => i.lhs.join(","))).toContain("plan_code");
  });
  it("the chase detects a lossy decomposition", () => {
    const lossy = chase(["o", "s", "p"], [{ label: "R1", attributes: ["o", "s"] }, { label: "R2", attributes: ["o", "p"] }],
      [{ lhs: ["p"], rhs: ["s"] }]);
    expect(lossy.holds).toBe(false);
    expect(preservation([{ label: "R1", attributes: ["a", "b"] }], [{ lhs: ["a"], rhs: ["c"] }])[0]!.preserved).toBe(false);
  });
});

describe("instance checks on the teaching snapshot (evidence)", () => {
  it("loads every relation with the expected row counts", () => {
    expect(sample.unf_sales_order).toHaveLength(3);
    expect(sample.nf1_order_line).toHaveLength(4);
    expect(sample.nf1_supplier_capability).toHaveLength(8);
    expect(sample.nf3_order_supplier_plan).toHaveLength(3);
    expect(sample.sales_order).toHaveLength(3); // pre-demo: order 5004 does not exist yet
    expect(sample.supplier_certification).toHaveLength(4);
  });
  it("every stage's reconstruction, key, FD and MVD checks report 0 violations, in memory and in SQL", () => {
    for (const r of data.reports) {
      const bad = r.checks.filter((c) => c.violations !== 0 || c.sqlViolations !== 0).map((c) => `${c.label}: ${c.violations}/${c.sqlViolations}`);
      expect(bad, r.stage).toEqual([]);
      expect(r.totals.sqlAgrees, r.stage).toBe(true);
      expect(r.checks.length, r.stage).toBeGreaterThan(0);
    }
    expect(data.totals.violations).toBe(0);
    expect(data.totals.sqlViolations).toBe(0);
    expect(data.reports.map((r) => r.stage)).toEqual(["UNF", "1NF", "2NF", "3NF", "BCNF", "4NF"]);
  });
  it("every decomposition reconstructs the original row count exactly", () => {
    const counts = Object.fromEntries(DECOMPOSITIONS.map((d) => [d.id, reconstruct(d, sample).original.length]));
    expect(counts).toEqual({
      "1nf-order-items": 4, "1nf-supplier-capability": 8, "2nf-order-line": 4,
      "3nf-order": 3, "3nf-product": 4, "3nf-order-line": 4, "bcnf-plan": 3, "4nf-capability": 8,
    });
    for (const r of data.reports) for (const c of r.checks.filter((x) => x.kind === "reconstruction")) {
      expect(c.detail.reconstructedRows, c.label).toBe(c.detail.originalRows);
    }
  });
  it("reports the sample-vs-proof distinction explicitly", () => {
    for (const r of data.reports) {
      expect(r.disclaimer).toBe(EVIDENCE_DISCLAIMER);
      expect(r.checks.every((c) => c.claim === "evidence")).toBe(true);
      expect(r.structural.every((s) => s.claim === "proof")).toBe(true);
    }
    expect(EVIDENCE_DISCLAIMER).toMatch(/evidence, not proof/);
    // An observed-in-sample FD passes the sample check but is not a design dependency.
    const obs = data.reports[2]!.checks.find((c) => c.basis === "observed-in-sample" && c.relation === "nf2_order_line");
    expect(obs?.violations).toBe(0);
  });
  it("audit F2: 0 on the pre-demo snapshot, 1 when sp_confirm_order(5001) runs first", () => {
    const f2 = simulateF2(sample);
    expect(f2.result).toBe(1);
    expect(reconstruct(decomposition("3nf-order"), sample).missing).toHaveLength(0);
  });
  it("audit F16 counterexample: both relations keep their keys but the join breaks the lost FD", () => {
    const c = bcnfCounterexample(sample);
    expect(c.result).toBe(1);
    expect(c.explanation).toContain("checked");
  });
});

describe("a deliberately corrupted in-memory sample is detected", () => {
  it("a changed warranty duration breaks plan_code → warranty_months and the 2NF reconstruction", () => {
    const bad = clone(sample);
    bad.nf2_order_line![0]!.warranty_months = 12;
    const r = verifyStage("2NF", bad);
    const fd = r.checks.find((c) => c.relation === "nf2_order_line" && c.label.includes("plan_code → warranty_months"));
    expect(fd?.violations).toBe(1);
    const rec = r.checks.find((c) => c.kind === "reconstruction")!;
    expect(rec.detail.missing).toBe(1);
    expect(rec.detail.spurious).toBe(1);
    expect(r.totals.violations).toBeGreaterThan(0);
    // Structural results do not change: the proof is about the schema, not this instance.
    expect(r.structural[0]!.lossless).toBe(true);
  });
  it("an extra order_plan row produces a spurious tuple in the BCNF join", () => {
    const bad = clone(sample);
    bad.order_plan!.push({ order_id: 5001, plan_code: "URBAN24" });
    const rec = verifyStage("BCNF", bad).checks.find((c) => c.kind === "reconstruction")!;
    expect(rec.detail.spurious).toBe(1);
    expect(rec.detail.missing).toBe(0);
  });
  it("a dropped JSON item and a broken cross product are caught at 1NF and 4NF", () => {
    const bad = clone(sample);
    (bad.unf_sales_order![0]!.items as unknown[]).pop();
    expect(verifyStage("1NF", bad).checks.find((c) => c.decompositionId === "1nf-order-items")!.detail.spurious).toBe(1);
    const cap = clone(sample);
    cap.nf3_supplier_capability = cap.nf3_supplier_capability!.slice(1);
    const r4 = verifyStage("4NF", cap);
    // The decomposed relations still yield the full cross product: one tuple the original no longer has.
    expect(r4.checks.find((c) => c.kind === "reconstruction")!.detail.spurious).toBe(1);
    expect(r4.checks.find((c) => c.kind === "mvd" && c.relation === "nf3_supplier_capability")!.violations).toBe(1);
  });
  it("duplicate keys and inconsistent postal areas are counted", () => {
    const bad = clone(sample);
    bad.unf_customer!.push({ ...bad.unf_customer![0]!, city: "Mysuru" });
    const r = verifyStage("UNF", bad);
    expect(r.checks.find((c) => c.kind === "key" && c.relation === "unf_customer")!.violations).toBe(1);
    expect(r.checks.find((c) => c.relation === "unf_customer" && c.label.includes("postal_code →"))!.violations).toBe(1);
    expect(fdViolations([{ a: 1, b: 1 }, { a: 1, b: 2 }], ["a"], ["b"])).toHaveLength(1);
    expect(mvdViolations([{ x: 1, y: 1, z: 1 }, { x: 1, y: 2, z: 2 }], ["x"], ["y"], ["x", "y", "z"])).toBe(2);
  });
  it("loadSample is read-only and repeatable", async () => {
    const again = await loadSample(pool);
    expect(again).toEqual(sample);
  });
});
