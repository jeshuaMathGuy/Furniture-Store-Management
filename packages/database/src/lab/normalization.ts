/**
 * Normalization Laboratory (Stage 5).
 *
 * Six stages, UNF → 1NF → 2NF → 3NF → BCNF → 4NF, defined exactly as
 * `database/original/furniture_store_normalized.sql` performs them, plus:
 *
 *  - pure dependency theory (attribute closure, candidate keys, normal-form
 *    tests, the chase, dependency preservation), so every key and every proof
 *    shown in the lab is COMPUTED from the declared dependencies, not hard-coded;
 *  - STRUCTURAL results (true for every legal instance that satisfies the
 *    dependencies, given the stated assumptions), and
 *  - DATA-INSTANCE checks (missing / spurious tuples, FD, key and MVD
 *    violations) run on the immutable teaching snapshot. A passing instance
 *    check is evidence, never proof.
 *
 * This module has no runtime imports, so it is safe to import from client
 * components. Only the functions that take a `Pool` touch the database, and
 * they only issue SELECT statements (use the lab_reader pool on the teaching schema).
 */
import type { Pool } from "../connection.js";

// ============================================================== vocabulary

export const NORMAL_FORMS = ["UNF", "1NF", "2NF", "3NF", "BCNF", "4NF"] as const;
export type NormalForm = (typeof NORMAL_FORMS)[number];

/**
 * Where a dependency comes from.
 *  - declared: enforced by a PRIMARY KEY / UNIQUE / generated column in the source DDL
 *    (on this relation, or on the relation the attributes were copied from, named in the rationale).
 *  - assumed: a business rule the script relies on but no constraint of this relation enforces.
 *  - observed-in-sample: happens to hold in the sample rows; NOT a design dependency.
 *    Observed dependencies are excluded from every structural computation.
 */
export type Basis = "declared" | "assumed" | "observed-in-sample";

export interface SourceRef { from: number; to: number; label: string }

export interface RelationSchema {
  /** Name used in the source SQL (permanent tables) or the session relation name. */
  name: string;
  /** Table in the teaching snapshot schema holding this relation's rows. */
  table: string;
  kind: "session" | "permanent";
  attributes: string[];
  /** JSON array attributes: repeating groups or multi-valued attributes (not atomic). */
  nonAtomic?: string[];
  /** Generated (computed) columns. Excluded from normal-form analysis: MySQL maintains them. */
  generated?: string[];
  /** PRIMARY KEY first, then UNIQUE keys, as declared in the source DDL. */
  declaredKeys: string[][];
  source: SourceRef;
  description: string;
}

export interface FunctionalDependency {
  id: string;
  kind: "fd";
  relation: string;
  lhs: string[];
  rhs: string[];
  basis: Basis;
  rationale: string;
  source?: SourceRef;
}

export interface MultivaluedDependency {
  id: string;
  kind: "mvd";
  relation: string;
  lhs: string[];
  /** X ↠ Y; the complement Z = R − X − Y is implied (X ↠ Y | Z). */
  rhs: string[];
  basis: Basis;
  rationale: string;
  source?: SourceRef;
}

export type Dependency = FunctionalDependency | MultivaluedDependency;

export interface FdSpec { lhs: string[]; rhs: string[]; basis: Basis; rationale: string }

// ============================================================== pure dependency theory

const uniq = (xs: Iterable<string>) => [...new Set(xs)];
const subset = (a: readonly string[], b: readonly string[]) => a.every((x) => b.includes(x));
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === new Set(b).size && subset(a, b) && subset(b, a);
const minus = (a: readonly string[], b: readonly string[]) => a.filter((x) => !b.includes(x));
const inter = (a: readonly string[], b: readonly string[]) => a.filter((x) => b.includes(x));

export interface FdLike { lhs: readonly string[]; rhs: readonly string[] }
export interface MvdLike { lhs: readonly string[]; rhs: readonly string[] }

/** Attribute closure X⁺ under F (Armstrong's axioms; the standard fixed-point algorithm). */
export function closure(attrs: readonly string[], fds: readonly FdLike[]): string[] {
  const out = uniq(attrs);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of fds) {
      if (subset(f.lhs, out)) {
        for (const a of f.rhs) if (!out.includes(a)) { out.push(a); changed = true; }
      }
    }
  }
  return out;
}

export function isSuperkey(attrs: readonly string[], all: readonly string[], fds: readonly FdLike[]): boolean {
  return subset(all, closure(attrs, fds));
}

/** Does F imply X → Y? */
export function implies(fds: readonly FdLike[], lhs: readonly string[], rhs: readonly string[]): boolean {
  return subset(rhs, closure(lhs, fds));
}

/** Restrict F to the FDs whose attributes all lie in `attrs` (used for FDs declared on one relation). */
export function fdsWithin(fds: readonly FdLike[], attrs: readonly string[]): FdLike[] {
  return fds
    .map((f) => ({ lhs: [...f.lhs], rhs: inter(f.rhs, attrs) }))
    .filter((f) => f.rhs.length > 0 && subset(f.lhs, attrs));
}

/**
 * All candidate keys of a relation over `all` under F.
 * Attributes that never appear on a right-hand side belong to every key (the core);
 * attributes that appear only on right-hand sides belong to none.
 */
export function candidateKeys(all: readonly string[], fds: readonly FdLike[]): string[][] {
  const scoped = fdsWithin(fds, all);
  const onRhs = new Set(scoped.flatMap((f) => minus(f.rhs, f.lhs)));
  const onLhs = new Set(scoped.flatMap((f) => f.lhs));
  const core = all.filter((a) => !onRhs.has(a));
  if (isSuperkey(core, all, scoped)) return [core];
  const optional = all.filter((a) => onRhs.has(a) && onLhs.has(a));
  const keys: string[][] = [];
  const n = optional.length;
  for (let size = 1; size <= n; size++) {
    const combo = (start: number, picked: string[]) => {
      if (picked.length === size) {
        const k = [...core, ...picked];
        if (keys.some((x) => subset(x, k))) return;
        if (isSuperkey(k, all, scoped)) keys.push(k);
        return;
      }
      for (let i = start; i < n; i++) combo(i + 1, [...picked, optional[i]!]);
    };
    combo(0, []);
  }
  return keys;
}

export const primeAttributes = (keys: readonly string[][]) => uniq(keys.flat());

export interface NfViolation {
  /** The normal form whose condition is violated. */
  nf: Exclude<NormalForm, "UNF">;
  lhs: string[];
  rhs: string[];
  kind: "non-atomic" | "partial" | "transitive" | "non-superkey-determinant" | "mvd";
  reason: string;
  dependencyId?: string;
}

export interface RelationAnalysis {
  relation: string;
  attributes: string[];
  keys: string[][];
  prime: string[];
  highest: NormalForm;
  violations: NfViolation[];
  /** Derived keys equal the keys declared in the DDL (as sets of sets). */
  declaredKeysMatch: boolean;
  excludedGenerated: string[];
}

export const fmtSet = (xs: readonly string[]) => (xs.length === 1 ? xs[0]! : `{${xs.join(", ")}}`);
export const fmtFd = (lhs: readonly string[], rhs: readonly string[]) => `${fmtSet(lhs)} → ${fmtSet(rhs)}`;
export const fmtMvd = (lhs: readonly string[], rhs: readonly string[]) => `${fmtSet(lhs)} ↠ ${fmtSet(rhs)}`;
const SUB = "₀₁₂₃₄₅₆₇₈₉";
export const sub = (n: number) => String(n).split("").map((d) => SUB[Number(d)]).join("");

const NEXT_LABEL: Record<Exclude<NormalForm, "UNF">, NormalForm> = { "1NF": "UNF", "2NF": "1NF", "3NF": "2NF", BCNF: "3NF", "4NF": "BCNF" };

/** Compute keys and the highest normal form of a relation from its DESIGN dependencies (observed ones excluded). */
export function analyzeRelation(schema: RelationSchema, deps: readonly Dependency[]): RelationAnalysis {
  const generated = schema.generated ?? [];
  const attrs = minus(schema.attributes, generated);
  const mine = deps.filter((d) => d.relation === schema.name && d.basis !== "observed-in-sample");
  const fdDeps = mine.filter((d): d is FunctionalDependency => d.kind === "fd")
    .map((d) => ({ ...d, rhs: minus(d.rhs, generated) }))
    .filter((d) => d.rhs.length > 0 && subset(d.lhs, attrs));
  const keys = candidateKeys(attrs, fdDeps);
  const prime = primeAttributes(keys);
  const violations: NfViolation[] = [];

  for (const a of schema.nonAtomic ?? []) {
    violations.push({ nf: "1NF", lhs: [], rhs: [a], kind: "non-atomic", reason: `${a} holds a JSON array, not one atomic value` });
  }
  // 2NF: no non-prime attribute depends on a proper subset of a candidate key.
  const nonPrime = minus(attrs, prime);
  const seenPartial = new Set<string>();
  for (const k of keys) {
    if (k.length < 2) continue;
    const subsets: string[][] = [];
    for (let mask = 1; mask < (1 << k.length) - 1; mask++) subsets.push(k.filter((_, i) => mask & (1 << i)));
    subsets.sort((x, y) => x.length - y.length);
    for (const x of subsets) {
      const dependents = inter(closure(x, fdDeps), nonPrime).filter((a) => {
        // report against the smallest determining subset only
        return !subsets.some((y) => y.length < x.length && subset(y, x) && closure(y, fdDeps).includes(a));
      });
      const key = x.join(",");
      if (dependents.length && !seenPartial.has(key)) {
        seenPartial.add(key);
        violations.push({ nf: "2NF", lhs: x, rhs: dependents, kind: "partial",
          reason: `${fmtFd(x, dependents)}: non-prime attributes depend on part of the key ${fmtSet(k)}` });
      }
    }
  }
  // 3NF and BCNF: check every given FD (sufficient when F is given on this relation).
  for (const f of fdDeps) {
    const rhs = minus(f.rhs, f.lhs);
    if (!rhs.length || isSuperkey(f.lhs, attrs, fdDeps)) continue;
    const nonPrimeRhs = minus(rhs, prime);
    const isPartial = keys.some((k) => k.length > f.lhs.length && subset(f.lhs, k));
    if (nonPrimeRhs.length && !isPartial) {
      violations.push({ nf: "3NF", lhs: f.lhs, rhs: nonPrimeRhs, kind: "transitive", dependencyId: f.id,
        reason: `${fmtFd(f.lhs, nonPrimeRhs)}: determinant is not a superkey and the dependent attributes are non-prime (transitive via ${fmtSet(f.lhs)})` });
    }
    const primeRhs = inter(rhs, prime);
    if (primeRhs.length) {
      violations.push({ nf: "BCNF", lhs: f.lhs, rhs: primeRhs, kind: "non-superkey-determinant", dependencyId: f.id,
        reason: `${fmtFd(f.lhs, primeRhs)}: determinant is not a superkey (allowed by 3NF only because ${fmtSet(primeRhs)} is prime)` });
    }
  }
  for (const m of mine.filter((d): d is MultivaluedDependency => d.kind === "mvd")) {
    const trivial = subset(m.rhs, m.lhs) || sameSet(uniq([...m.lhs, ...m.rhs]), attrs);
    if (!trivial && !isSuperkey(m.lhs, attrs, fdDeps)) {
      const z = minus(minus(attrs, m.lhs), m.rhs);
      violations.push({ nf: "4NF", lhs: m.lhs, rhs: m.rhs, kind: "mvd", dependencyId: m.id,
        reason: `${fmtMvd(m.lhs, m.rhs)} | ${fmtSet(z)}: non-trivial MVD whose determinant is not a superkey` });
    }
  }
  const order: Exclude<NormalForm, "UNF">[] = ["1NF", "2NF", "3NF", "BCNF", "4NF"];
  const firstFail = order.find((nf) => violations.some((v) => v.nf === nf));
  const highest: NormalForm = firstFail ? NEXT_LABEL[firstFail] : "4NF";
  const declaredKeysMatch = schema.declaredKeys.length === keys.length
    && schema.declaredKeys.every((dk) => keys.some((k) => sameSet(dk, k)));
  return { relation: schema.name, attributes: attrs, keys, prime, highest, violations, declaredKeysMatch, excludedGenerated: generated };
}

// ---------------------------------------------------------------- the chase

export interface ChaseResult {
  holds: boolean;
  universe: string[];
  /** Final tableau: "a" is a distinguished symbol; "b<i>" are non-distinguished. */
  rows: { label: string; cells: string[] }[];
  /** Index of the first all-"a" row, or null. */
  losslessRow: number | null;
  rounds: number;
}

/** Chase test for a lossless join of `parts` over `universe` under FDs and MVDs. */
export function chase(universe: readonly string[], parts: { label: string; attributes: readonly string[] }[],
  fds: readonly FdLike[], mvds: readonly MvdLike[] = []): ChaseResult {
  const col = (a: string) => universe.indexOf(a);
  let rows: { label: string; cells: string[] }[] = parts.map((p, i) => ({
    label: p.label,
    cells: universe.map((a, j) => (p.attributes.includes(a) ? "a" : `b${i + 1}${sub(j + 1)}`)),
  }));
  const allA = (r: string[]) => r.every((c) => c === "a");
  let rounds = 0;
  for (let guard = 0; guard < 200; guard++) {
    rounds++;
    let changed = false;
    for (const f of fds) {
      const L = f.lhs.map(col), R = f.rhs.map(col);
      if (L.some((x) => x < 0) || R.some((x) => x < 0)) continue;
      for (let i = 0; i < rows.length; i++) for (let k = i + 1; k < rows.length; k++) {
        const ri = rows[i]!.cells, rk = rows[k]!.cells;
        if (!L.every((c) => ri[c] === rk[c])) continue;
        for (const c of R) {
          const x = ri[c]!, y = rk[c]!;
          if (x === y) continue;
          const keep = x === "a" || y === "a" ? "a" : x < y ? x : y;
          const drop = keep === x ? y : x;
          for (const r of rows) if (r.cells[c] === drop) r.cells[c] = keep;
          changed = true;
        }
      }
    }
    for (const m of mvds) {
      const L = m.lhs.map(col), Y = m.rhs.map(col);
      if (L.some((x) => x < 0) || Y.some((x) => x < 0)) continue;
      const add: { label: string; cells: string[] }[] = [];
      for (const t1 of rows) for (const t2 of rows) {
        if (t1 === t2 || !L.every((c) => t1.cells[c] === t2.cells[c])) continue;
        const cells = universe.map((_, c) => (L.includes(c) || Y.includes(c) ? t1.cells[c]! : t2.cells[c]!));
        const exists = [...rows, ...add].some((r) => r.cells.every((v, j) => v === cells[j]));
        if (!exists) add.push({ label: `${t1.label}⊗${t2.label}`, cells });
      }
      if (add.length) { rows = [...rows, ...add]; changed = true; }
    }
    if (!changed || rows.some((r) => allA(r.cells))) break;
  }
  const idx = rows.findIndex((r) => allA(r.cells));
  return { holds: idx >= 0, universe: [...universe], rows, losslessRow: idx >= 0 ? idx : null, rounds };
}

// ---------------------------------------------------------------- binary criterion and preservation

export interface BinaryStep {
  left: string;
  right: string;
  leftAttrs: string[];
  rightAttrs: string[];
  common: string[];
  commonClosure: string[];
  /** Which side the common attributes determine (FD), or "mvd" when (R₁ ∩ R₂) ↠ R₁ − R₂ holds. */
  determines: "left" | "right" | "mvd" | null;
  /** e.g. "R₁ ∩ R₂ = {plan_code} → R₂" */
  notation: string;
}

/**
 * Join the parts left to right; at step k the relation built so far (R₁ ⋈ … ⋈ Rₖ) is joined with Rₖ₊₁.
 * Each step is lossless when the common attributes functionally determine one side
 * (R₁ ∩ R₂ → R₁ or R₁ ∩ R₂ → R₂), or multivalued-determine the difference (Fagin).
 */
export function binarySteps(universe: readonly string[], parts: { label: string; attributes: readonly string[] }[],
  fds: readonly FdLike[], mvds: readonly MvdLike[] = []): BinaryStep[] {
  const steps: BinaryStep[] = [];
  let leftAttrs = [...parts[0]!.attributes];
  let leftLabel = parts[0]!.label;
  for (let k = 1; k < parts.length; k++) {
    const r = parts[k]!;
    const common = inter(leftAttrs, r.attributes);
    const cl = inter(closure(common, fds), universe);
    let determines: BinaryStep["determines"] = subset(r.attributes, cl) ? "right" : subset(leftAttrs, cl) ? "left" : null;
    if (!determines) {
      const onlyLeft = minus(leftAttrs, r.attributes), onlyRight = minus(r.attributes, leftAttrs);
      const rest = minus(universe, common);
      const ok = mvds.some((m) => sameSet([...m.lhs], common) && (sameSet([...m.rhs], onlyLeft) || sameSet([...m.rhs], onlyRight)
        || sameSet(minus(rest, m.rhs), onlyLeft) || sameSet(minus(rest, m.rhs), onlyRight)));
      if (ok) determines = "mvd";
    }
    const L = k === 1 ? `R${sub(1)}` : `(R${sub(1)} ⋈ … ⋈ R${sub(k)})`;
    const R = `R${sub(k + 1)}`;
    const notation = determines === "right" ? `${L} ∩ ${R} = ${fmtSet(common)} → ${R}`
      : determines === "left" ? `${L} ∩ ${R} = ${fmtSet(common)} → ${L}`
      : determines === "mvd" ? `${L} ∩ ${R} = ${fmtSet(common)} ↠ ${L} − ${R}`
      : `${L} ∩ ${R} = ${fmtSet(common)} determines neither side`;
    steps.push({ left: leftLabel, right: r.label, leftAttrs: [...leftAttrs], rightAttrs: [...r.attributes], common, commonClosure: cl, determines, notation });
    leftAttrs = uniq([...leftAttrs, ...r.attributes]);
    leftLabel = `${leftLabel} ⋈ ${r.label}`;
  }
  return steps;
}

export interface PreservationItem {
  lhs: string[];
  rhs: string[];
  basis: Basis;
  preserved: boolean;
  /** Attributes reachable from the LHS using only FDs that hold inside single parts. */
  reached: string[];
  /** A part that contains the whole FD, if any. */
  localTo: string | null;
}

/**
 * Dependency preservation without computing (F|Rᵢ)⁺: for X → Y, grow Z := X with
 * Z := Z ∪ ((Z ∩ Rᵢ)⁺ ∩ Rᵢ) over all parts until stable; preserved iff Y ⊆ Z.
 */
export function preservation(parts: { label: string; attributes: readonly string[] }[], fds: readonly (FdLike & { basis?: Basis })[]): PreservationItem[] {
  return fds.map((f) => {
    let z = [...f.lhs];
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of parts) {
        const add = inter(closure(inter(z, p.attributes), fds), p.attributes);
        for (const a of add) if (!z.includes(a)) { z.push(a); changed = true; }
      }
    }
    const local = parts.find((p) => subset([...f.lhs, ...f.rhs], p.attributes));
    return { lhs: [...f.lhs], rhs: [...f.rhs], basis: f.basis ?? "declared", preserved: subset(f.rhs, z), reached: z, localTo: local?.label ?? null };
  });
}

// ============================================================== the source schema

const L = (from: number, to: number, label: string): SourceRef => ({ from, to, label });

const R = (r: RelationSchema) => r;

export const RELATIONS: Record<string, RelationSchema> = Object.fromEntries([
  // ---------------- UNF (lines 58–128)
  R({ name: "unf_customer", table: "unf_customer", kind: "session", source: L(58, 103, "CREATE TEMPORARY TABLE unf_customer + rows"),
    attributes: ["customer_id", "customer_name", "customer_email", "postal_code", "city", "region", "is_active"],
    declaredKeys: [["customer_id"]], description: "Customers with their postal area copied inline." }),
  R({ name: "unf_supplier", table: "unf_supplier", kind: "session", source: L(68, 107, "CREATE TEMPORARY TABLE unf_supplier + rows"),
    attributes: ["supplier_id", "supplier_name", "supplier_phone", "certifications", "service_regions", "is_active"],
    nonAtomic: ["certifications", "service_regions"], declaredKeys: [["supplier_id"]],
    description: "Suppliers with two independent multi-valued attributes stored as JSON arrays." }),
  R({ name: "unf_product", table: "unf_product", kind: "session", source: L(77, 113, "CREATE TEMPORARY TABLE unf_product + rows"),
    attributes: ["product_id", "product_name", "supplier_id", "supplier_name", "supplier_phone", "list_price", "is_active"],
    declaredKeys: [["product_id"]], description: "Products with the supplier's name and phone repeated on every product." }),
  R({ name: "unf_sales_order", table: "unf_sales_order", kind: "session", source: L(87, 128, "CREATE TEMPORARY TABLE unf_sales_order + rows"),
    attributes: ["order_id", "order_date", "customer_id", "customer_name", "customer_email", "postal_code", "city", "region", "order_status", "items"],
    nonAtomic: ["items"], declaredKeys: [["order_id"]],
    description: "Orders with the customer copied in and the order lines as a JSON repeating group (items)." }),
  // ---------------- 1NF (lines 130–181)
  R({ name: "nf1_order_line", table: "nf1_order_line", kind: "session", source: L(130, 164, "JSON_TABLE unnesting of items"),
    attributes: ["order_id", "product_id", "order_date", "customer_id", "customer_name", "customer_email", "postal_code", "city", "region",
      "product_name", "supplier_id", "supplier_name", "supplier_phone", "product_list_price", "quantity", "unit_price", "plan_code", "warranty_months"],
    declaredKeys: [["order_id", "product_id"]], description: "One row per order item; every value atomic." }),
  R({ name: "nf1_supplier_capability", table: "nf1_supplier_capability", kind: "session", source: L(166, 181, "JSON_TABLE × JSON_TABLE"),
    attributes: ["supplier_id", "certification", "service_region"], declaredKeys: [["supplier_id", "certification", "service_region"]],
    description: "Every certification paired with every service region of the supplier (all-key)." }),
  // ---------------- 2NF (lines 183–244)
  R({ name: "nf2_order", table: "nf2_order", kind: "session", source: L(183, 198, "SELECT DISTINCT … FROM unf_sales_order"),
    attributes: ["order_id", "order_date", "customer_id", "customer_name", "customer_email", "postal_code", "city", "region", "order_status"],
    declaredKeys: [["order_id"]], description: "Order header: the attributes that depend on order_id alone." }),
  R({ name: "nf2_product", table: "nf2_product", kind: "session", source: L(200, 219, "SELECT … FROM unf_product"),
    attributes: ["product_id", "product_name", "supplier_id", "supplier_name", "supplier_phone", "list_price", "is_active"],
    declaredKeys: [["product_id"]], description: "Product attributes: the attributes that depend on product_id alone." }),
  R({ name: "nf2_order_line", table: "nf2_order_line", kind: "session", source: L(221, 233, "SELECT … FROM nf1_order_line"),
    attributes: ["order_id", "product_id", "quantity", "unit_price", "plan_code", "warranty_months"],
    declaredKeys: [["order_id", "product_id"]], description: "What depends on the whole key (order_id, product_id)." }),
  R({ name: "nf2_supplier_capability", table: "nf2_supplier_capability", kind: "session", source: L(235, 244, "copy of nf1_supplier_capability"),
    attributes: ["supplier_id", "certification", "service_region"], declaredKeys: [["supplier_id", "certification", "service_region"]],
    description: "Unchanged: an all-key relation has no partial dependencies." }),
  // ---------------- 3NF (lines 246–333; permanent tables declared at lines 20–56)
  R({ name: "postal_area", table: "base_postal_area", kind: "permanent", source: L(246, 253, "CREATE TABLE postal_area + INSERT … FROM nf2_order"),
    attributes: ["postal_code", "city", "region"], declaredKeys: [["postal_code"]], description: "postal_code → city, region, stored once." }),
  R({ name: "customer", table: "base_customer", kind: "permanent", source: L(20, 26, "CREATE TABLE customer (loaded at 255–257)"),
    attributes: ["customer_id", "customer_name", "email", "postal_code", "is_active"], declaredKeys: [["customer_id"], ["email"]],
    description: "Customer facts, loaded from unf_customer." }),
  R({ name: "supplier", table: "base_supplier", kind: "permanent", source: L(28, 33, "CREATE TABLE supplier (loaded at 259–261)"),
    attributes: ["supplier_id", "supplier_name", "phone", "is_active"], declaredKeys: [["supplier_id"], ["supplier_name"]],
    description: "Supplier facts, loaded from unf_supplier." }),
  R({ name: "product", table: "base_product", kind: "permanent", source: L(35, 45, "CREATE TABLE product (loaded at 263–265)"),
    attributes: ["product_id", "product_name", "supplier_id", "list_price", "is_active"], declaredKeys: [["product_id"]],
    description: "Product facts with a foreign key to supplier." }),
  R({ name: "sales_order", table: "base_sales_order", kind: "permanent", source: L(47, 56, "CREATE TABLE sales_order (loaded at 267–269)"),
    attributes: ["order_id", "customer_id", "order_date", "order_status"], declaredKeys: [["order_id"]],
    description: "Order header with a foreign key to customer." }),
  R({ name: "order_line", table: "base_order_line", kind: "permanent", source: L(275, 296, "CREATE TABLE order_line + INSERT … FROM nf2_order_line"),
    attributes: ["order_id", "product_id", "quantity", "unit_price", "discount_pct", "line_total"], generated: ["line_total"],
    declaredKeys: [["order_id", "product_id"]], description: "Order lines. line_total is a STORED generated column." }),
  R({ name: "warranty_plan", table: "base_warranty_plan", kind: "permanent", source: L(298, 309, "CREATE TABLE warranty_plan + INSERT … FROM nf1_order_line"),
    attributes: ["plan_code", "supplier_id", "warranty_months"], declaredKeys: [["plan_code"]],
    description: "plan_code → supplier_id, warranty_months, stored once." }),
  R({ name: "nf3_order_supplier_plan", table: "nf3_order_supplier_plan", kind: "session", source: L(311, 322, "CREATE TEMPORARY TABLE nf3_order_supplier_plan"),
    attributes: ["order_id", "supplier_id", "plan_code"], declaredKeys: [["order_id", "supplier_id"], ["order_id", "plan_code"]],
    description: "Which warranty plan each order uses for each supplier. PRIMARY KEY (order_id, supplier_id), UNIQUE (order_id, plan_code)." }),
  R({ name: "nf3_supplier_capability", table: "nf3_supplier_capability", kind: "session", source: L(324, 333, "copy of nf2_supplier_capability (re-created at 979–998)"),
    attributes: ["supplier_id", "certification", "service_region"], declaredKeys: [["supplier_id", "certification", "service_region"]],
    description: "Still the certification × region cross product: in BCNF (no non-trivial FDs) but not in 4NF." }),
  // ---------------- BCNF (lines 335–347)
  R({ name: "order_plan", table: "base_order_plan", kind: "permanent", source: L(335, 347, "CREATE TABLE order_plan + INSERT … FROM nf3_order_supplier_plan"),
    attributes: ["order_id", "plan_code"], declaredKeys: [["order_id", "plan_code"]], description: "Which plans an order uses (all-key)." }),
  // ---------------- 4NF (lines 349–371)
  R({ name: "supplier_certification", table: "base_supplier_certification", kind: "permanent", source: L(349, 367, "CREATE TABLE supplier_certification + INSERT"),
    attributes: ["supplier_id", "certification"], declaredKeys: [["supplier_id", "certification"]], description: "Certifications per supplier." }),
  R({ name: "supplier_service_region", table: "base_supplier_service_region", kind: "permanent", source: L(357, 371, "CREATE TABLE supplier_service_region + INSERT"),
    attributes: ["supplier_id", "service_region"], declaredKeys: [["supplier_id", "service_region"]], description: "Service regions per supplier." }),
].map((r) => [r.name, r]));

export function relation(name: string): RelationSchema {
  const r = RELATIONS[name];
  if (!r) throw new Error(`Unknown relation ${name}`);
  return r;
}

// ---------------------------------------------------------------- dependencies

const ORDER_HEADER = ["order_date", "customer_id", "customer_name", "customer_email", "postal_code", "city", "region"];
const PRODUCT_ATTRS = ["product_name", "supplier_id", "supplier_name", "supplier_phone"];
let depSeq = 0;
const fd = (relation: string, lhs: string[], rhs: string[], basis: Basis, rationale: string, source?: SourceRef): FunctionalDependency =>
  ({ id: `${relation}#fd${++depSeq}`, kind: "fd", relation, lhs, rhs, basis, rationale, source });
const mvd = (relation: string, lhs: string[], rhs: string[], basis: Basis, rationale: string, source?: SourceRef): MultivaluedDependency =>
  ({ id: `${relation}#mvd${++depSeq}`, kind: "mvd", relation, lhs, rhs, basis, rationale, source });
const keyFd = (name: string, key: string[], rationale: string, source: SourceRef) =>
  fd(name, key, minus(relation(name).attributes, key), "declared", rationale, source);

const POSTAL = "Each postal code lies in one city and region. The script checks it on unf_customer (lines 1066–1071); declared later as postal_area's PRIMARY KEY.";
const CUSTOMER = "An order copies its customer's details; a customer has one name, e-mail and postal code (customer_id is unf_customer's PRIMARY KEY, line 59).";
const SUPPLIER = "A supplier has one name and phone. The script checks unf_product against unf_supplier (lines 1077–1079).";
const PLAN = "Each plan belongs to one supplier and has one duration. Checked by the script on nf1_order_line (lines 1072–1076); declared later as warranty_plan's PRIMARY KEY (line 299).";
const ORDER_SUPPLIER_PLAN = "An order uses one warranty plan per supplier. Declared later as nf3_order_supplier_plan's PRIMARY KEY (line 315).";
const CAPABILITY = "Certifications and service regions are independent facts about a supplier, so every pair appears (the script's own expected_rows check, lines 1046–1053).";
const OBS_PLAN = "Each of the three sample orders happens to use one plan. Not a rule: an order with products from two suppliers has two plans, which uq_order_plan (line 316) explicitly allows.";
const OBS_CITY = "In the sample each city lies in one region. Nothing in the script relies on it.";

export const DEPENDENCIES: Dependency[] = [
  // UNF
  keyFd("unf_customer", ["customer_id"], "PRIMARY KEY (line 59)", L(59, 59, "customer_id INT PRIMARY KEY")),
  fd("unf_customer", ["postal_code"], ["city", "region"], "assumed", POSTAL, L(1066, 1071, "functional_dependency_consistency")),
  keyFd("unf_supplier", ["supplier_id"], "PRIMARY KEY (line 69)", L(69, 69, "supplier_id INT PRIMARY KEY")),
  keyFd("unf_product", ["product_id"], "PRIMARY KEY (line 78)", L(78, 78, "product_id INT PRIMARY KEY")),
  fd("unf_product", ["supplier_id"], ["supplier_name", "supplier_phone"], "assumed", SUPPLIER, L(1077, 1079, "functional_dependency_consistency")),
  keyFd("unf_sales_order", ["order_id"], "PRIMARY KEY (line 88)", L(88, 88, "order_id INT PRIMARY KEY")),
  fd("unf_sales_order", ["customer_id"], ["customer_name", "customer_email", "postal_code"], "assumed", CUSTOMER),
  fd("unf_sales_order", ["postal_code"], ["city", "region"], "assumed", POSTAL, L(1066, 1071, "functional_dependency_consistency")),
  fd("unf_sales_order", ["city"], ["region"], "observed-in-sample", OBS_CITY),
  // 1NF
  keyFd("nf1_order_line", ["order_id", "product_id"], "PRIMARY KEY (order_id, product_id) (line 149)", L(149, 149, "PRIMARY KEY (order_id, product_id)")),
  fd("nf1_order_line", ["order_id"], ORDER_HEADER, "declared", "Copied from unf_sales_order, whose PRIMARY KEY is order_id (line 88).", L(153, 156, "o.* columns")),
  fd("nf1_order_line", ["product_id"], [...PRODUCT_ATTRS, "product_list_price"], "declared", "Copied from unf_product, whose PRIMARY KEY is product_id (line 78).", L(154, 164, "p.* columns")),
  fd("nf1_order_line", ["customer_id"], ["customer_name", "customer_email", "postal_code"], "assumed", CUSTOMER),
  fd("nf1_order_line", ["postal_code"], ["city", "region"], "assumed", POSTAL),
  fd("nf1_order_line", ["supplier_id"], ["supplier_name", "supplier_phone"], "assumed", SUPPLIER),
  fd("nf1_order_line", ["plan_code"], ["supplier_id", "warranty_months"], "assumed", PLAN, L(1072, 1076, "functional_dependency_consistency")),
  fd("nf1_order_line", ["order_id", "supplier_id"], ["plan_code"], "assumed", ORDER_SUPPLIER_PLAN, L(315, 315, "PRIMARY KEY (order_id,supplier_id)")),
  fd("nf1_order_line", ["order_id"], ["plan_code"], "observed-in-sample", OBS_PLAN),
  mvd("nf1_supplier_capability", ["supplier_id"], ["certification"], "assumed", CAPABILITY, L(1046, 1053, "expected_rows")),
  // 2NF
  keyFd("nf2_order", ["order_id"], "PRIMARY KEY (line 184)", L(184, 184, "order_id INT PRIMARY KEY")),
  fd("nf2_order", ["customer_id"], ["customer_name", "customer_email", "postal_code"], "assumed", CUSTOMER),
  fd("nf2_order", ["postal_code"], ["city", "region"], "assumed", POSTAL),
  fd("nf2_order", ["city"], ["region"], "observed-in-sample", OBS_CITY),
  keyFd("nf2_product", ["product_id"], "PRIMARY KEY (line 201)", L(201, 201, "product_id INT PRIMARY KEY")),
  fd("nf2_product", ["supplier_id"], ["supplier_name", "supplier_phone"], "assumed", SUPPLIER),
  keyFd("nf2_order_line", ["order_id", "product_id"], "PRIMARY KEY (order_id, product_id) (line 228)", L(228, 228, "PRIMARY KEY (order_id, product_id)")),
  fd("nf2_order_line", ["plan_code"], ["warranty_months"], "assumed", PLAN),
  fd("nf2_order_line", ["order_id"], ["plan_code"], "observed-in-sample", OBS_PLAN),
  mvd("nf2_supplier_capability", ["supplier_id"], ["certification"], "assumed", CAPABILITY),
  // 3NF
  keyFd("postal_area", ["postal_code"], "PRIMARY KEY (line 247)", L(247, 247, "postal_code PRIMARY KEY")),
  keyFd("customer", ["customer_id"], "PRIMARY KEY (line 21)", L(21, 21, "customer_id INT PRIMARY KEY")),
  fd("customer", ["email"], ["customer_id"], "declared", "email is UNIQUE (line 23), so it is a second candidate key.", L(23, 23, "email … UNIQUE")),
  keyFd("supplier", ["supplier_id"], "PRIMARY KEY (line 29)", L(29, 29, "supplier_id INT PRIMARY KEY")),
  fd("supplier", ["supplier_name"], ["supplier_id"], "declared", "supplier_name is UNIQUE (line 30), so it is a second candidate key.", L(30, 30, "supplier_name … UNIQUE")),
  keyFd("product", ["product_id"], "PRIMARY KEY (line 36)", L(36, 36, "product_id INT PRIMARY KEY")),
  keyFd("sales_order", ["order_id"], "PRIMARY KEY (line 48)", L(48, 48, "order_id INT PRIMARY KEY")),
  keyFd("order_line", ["order_id", "product_id"], "PRIMARY KEY (order_id, product_id) (line 283)", L(283, 283, "PRIMARY KEY (order_id,product_id)")),
  fd("order_line", ["quantity", "unit_price", "discount_pct"], ["line_total"], "declared",
    "STORED generated column (lines 281–282). Excluded from normal-form analysis: MySQL computes it, so it cannot become inconsistent.", L(281, 282, "GENERATED ALWAYS AS")),
  keyFd("warranty_plan", ["plan_code"], "PRIMARY KEY (line 299)", L(299, 299, "plan_code PRIMARY KEY")),
  fd("nf3_order_supplier_plan", ["order_id", "supplier_id"], ["plan_code"], "declared", "PRIMARY KEY (order_id, supplier_id) (line 315)", L(315, 315, "PRIMARY KEY (order_id,supplier_id)")),
  fd("nf3_order_supplier_plan", ["order_id", "plan_code"], ["supplier_id"], "declared", "UNIQUE KEY uq_order_plan (order_id, plan_code) (line 316)", L(316, 316, "UNIQUE KEY uq_order_plan")),
  fd("nf3_order_supplier_plan", ["plan_code"], ["supplier_id"], "assumed", PLAN),
  mvd("nf3_supplier_capability", ["supplier_id"], ["certification"], "assumed", CAPABILITY, L(1046, 1053, "expected_rows")),
  // BCNF / 4NF relations: all-key, no non-trivial FDs.
];

export const dependenciesOf = (relationName: string) => DEPENDENCIES.filter((d) => d.relation === relationName);
const designFdsOf = (relationName: string) =>
  dependenciesOf(relationName).filter((d): d is FunctionalDependency => d.kind === "fd" && d.basis !== "observed-in-sample");

// ---------------------------------------------------------------- decompositions

export interface DecompositionPart {
  relation: string;
  /** Attributes of the universe this part carries (a projection). */
  attributes: string[];
  /** universe attribute → column in the part's relation, where the names differ. */
  columns?: Record<string, string>;
}

export interface Decomposition {
  id: string;
  stage: NormalForm;
  title: string;
  method: "unnest" | "projection";
  original: {
    relation: string;
    /** Join a projection of another relation onto the original to form the universe (see 3NF order lines). */
    augment?: { relation: string; on: string[]; attributes: string[]; rationale: string };
  };
  /** U: the attributes the decomposition must reconstruct. */
  universe: string[];
  parts: DecompositionPart[];
  /** Dependencies over U beyond the original relation's own (e.g. those involving augmented attributes). */
  extraFds?: FdSpec[];
  unnest?: { builder: "order-items" | "supplier-capability"; argument: string[] };
  notes: string[];
  source: SourceRef[];
  scriptCheck?: { name: string; from: number; to: number; note: string };
}

const NF1_COLUMNS = relation("nf1_order_line").attributes;

export const DECOMPOSITIONS: Decomposition[] = [
  {
    id: "1nf-order-items", stage: "1NF", title: "Unnest the items repeating group", method: "unnest",
    original: { relation: "unf_sales_order", augment: { relation: "unf_product", on: ["product_id"], attributes: [...PRODUCT_ATTRS, "list_price"],
      rationale: "Line 164 joins unf_product to copy the product, supplier and list price onto every line." } },
    universe: NF1_COLUMNS,
    parts: [{ relation: "nf1_order_line", attributes: NF1_COLUMNS }],
    unnest: { builder: "order-items", argument: [
      "JSON_TABLE(o.items, '$[*]') turns each array element into one row, repeating the order header (μ, unnest).",
      "Nesting the rows back by order_id (ν, JSON_ARRAYAGG … GROUP BY order_id) rebuilds every items array, because (order_id, product_id) is unique (nf1 PRIMARY KEY), so no two items of one order collapse into one row.",
      "Assumptions: every order has at least one item (an empty array would make the order vanish), and every item's product_id exists in unf_product (line 164 is an inner join).",
    ] },
    notes: [
      "nf1_order_line does not carry order_status or the is_active flags. The script re-reads order_status from unf_sales_order when it builds nf2_order (line 195), so the 1NF relation alone is not the whole UNF order.",
      "list_price is renamed product_list_price.",
    ],
    source: [L(130, 164, "nf1_order_line")],
    scriptCheck: { name: "unf_to_nf1_expansion", from: 874, to: 886, note: "Reports 0 in the script's own run." },
  },
  {
    id: "1nf-supplier-capability", stage: "1NF", title: "Unnest certifications and service regions", method: "unnest",
    original: { relation: "unf_supplier" },
    universe: ["supplier_id", "certification", "service_region"],
    parts: [{ relation: "nf1_supplier_capability", attributes: ["supplier_id", "certification", "service_region"] }],
    unnest: { builder: "supplier-capability", argument: [
      "Two JSON_TABLE calls in one FROM clause produce the Cartesian product certifications × service_regions per supplier.",
      "The arrays are recovered by projecting and nesting: certifications = JSON_ARRAYAGG(DISTINCT certification), service_regions = JSON_ARRAYAGG(DISTINCT service_region), per supplier_id.",
      "Assumptions: neither array is empty (an empty array would remove the supplier) and order inside an array carries no meaning.",
    ] },
    notes: ["The cross product is the price of 1NF here: it creates the multivalued dependency that 4NF removes."],
    source: [L(166, 181, "nf1_supplier_capability")],
  },
  {
    id: "2nf-order-line", stage: "2NF", title: "Remove partial dependencies on (order_id, product_id)", method: "projection",
    original: { relation: "nf1_order_line" },
    universe: NF1_COLUMNS,
    parts: [
      { relation: "nf2_order", attributes: ["order_id", ...ORDER_HEADER] },
      { relation: "nf2_order_line", attributes: ["order_id", "product_id", "quantity", "unit_price", "plan_code", "warranty_months"] },
      { relation: "nf2_product", attributes: ["product_id", ...PRODUCT_ATTRS, "product_list_price"], columns: { product_list_price: "list_price" } },
    ],
    notes: [
      "nf2_order is filled from unf_sales_order (line 198), so it also carries order_status; nf2_product is filled from unf_product (line 219), so it also carries is_active. Those attributes are outside nf1_order_line and outside this proof.",
      "nf2_supplier_capability is a straight copy of nf1_supplier_capability (lines 242–244): an all-key relation has no partial dependency.",
    ],
    source: [L(183, 244, "nf2_*")],
    scriptCheck: { name: "nf1_to_nf2_lossless", from: 888, to: 899, note: "Reports 0 in the script's own run." },
  },
  {
    id: "3nf-order", stage: "3NF", title: "Order header: remove customer and postal-area transitivity", method: "projection",
    original: { relation: "nf2_order" },
    universe: relation("nf2_order").attributes,
    parts: [
      { relation: "sales_order", attributes: ["order_id", "customer_id", "order_date", "order_status"] },
      { relation: "customer", attributes: ["customer_id", "customer_name", "customer_email", "postal_code"], columns: { customer_email: "email" } },
      { relation: "postal_area", attributes: ["postal_code", "city", "region"] },
    ],
    notes: [
      "customer is loaded from unf_customer (line 255), not from nf2_order, and gets is_active = TRUE regardless of the source (audit F8).",
      "postal_area is filled only from postal codes that appear in orders (line 253; audit F5).",
      "Audit F2: the script's own nf2_to_3nf_order_lossless check runs after CALL sp_confirm_order(5001) (line 849), which changes order 5001 from placed to confirmed, so it reports 1 violation. On the pre-demo snapshot used here it is 0.",
    ],
    source: [L(246, 273, "postal_area, customer, sales_order")],
    scriptCheck: { name: "nf2_to_3nf_order_lossless", from: 901, to: 910, note: "Reports 1 in the script's run because of operation order (audit F2); 0 on the pre-demo snapshot." },
  },
  {
    id: "3nf-product", stage: "3NF", title: "Product: remove supplier transitivity", method: "projection",
    original: { relation: "nf2_product" },
    universe: relation("nf2_product").attributes,
    parts: [
      { relation: "product", attributes: ["product_id", "product_name", "supplier_id", "list_price", "is_active"] },
      { relation: "supplier", attributes: ["supplier_id", "supplier_name", "supplier_phone"], columns: { supplier_phone: "phone" } },
    ],
    notes: ["supplier is loaded from unf_supplier (line 259)."],
    source: [L(259, 265, "supplier, product")],
    scriptCheck: { name: "nf2_to_3nf_product_lossless", from: 912, to: 919, note: "Reports 0 in the script's own run." },
  },
  {
    id: "3nf-order-line", stage: "3NF", title: "Order line: move the warranty plan out", method: "projection",
    original: { relation: "nf2_order_line", augment: { relation: "nf2_product", on: ["product_id"], attributes: ["supplier_id"],
      rationale: "plan_code is tied to the supplier of each line's product, so the universe includes supplier_id (product_id → supplier_id; lossless because product_id is nf2_product's key)." } },
    universe: ["order_id", "product_id", "supplier_id", "quantity", "unit_price", "plan_code", "warranty_months"],
    parts: [
      { relation: "order_line", attributes: ["order_id", "product_id", "quantity", "unit_price"] },
      { relation: "product", attributes: ["product_id", "supplier_id"] },
      { relation: "nf3_order_supplier_plan", attributes: ["order_id", "supplier_id", "plan_code"] },
      { relation: "warranty_plan", attributes: ["plan_code", "supplier_id", "warranty_months"] },
    ],
    extraFds: [
      { lhs: ["product_id"], rhs: ["supplier_id"], basis: "declared", rationale: "PRIMARY KEY of nf2_product / product." },
      { lhs: ["plan_code"], rhs: ["supplier_id"], basis: "assumed", rationale: PLAN },
      { lhs: ["order_id", "supplier_id"], rhs: ["plan_code"], basis: "assumed", rationale: ORDER_SUPPLIER_PLAN },
    ],
    notes: [
      "order_line gains discount_pct (default 0) and the generated line_total; neither is part of nf2_order_line.",
      "The script's own nf2_order_line_reconstruction check (lines 921–942) uses order_plan, the BCNF relation; the 3NF form uses nf3_order_supplier_plan.",
    ],
    source: [L(275, 322, "order_line, warranty_plan, nf3_order_supplier_plan")],
    scriptCheck: { name: "nf2_order_line_reconstruction", from: 921, to: 942, note: "Reports 0 in the script's own run." },
  },
  {
    id: "bcnf-plan", stage: "BCNF", title: "Split on plan_code → supplier_id", method: "projection",
    original: { relation: "nf3_order_supplier_plan" },
    universe: ["order_id", "supplier_id", "plan_code"],
    parts: [
      { relation: "order_plan", attributes: ["order_id", "plan_code"] },
      { relation: "warranty_plan", attributes: ["plan_code", "supplier_id"] },
    ],
    notes: [
      "warranty_plan already exists from the 3NF step; the BCNF split reuses its (plan_code, supplier_id) projection and adds order_plan.",
      "Audit F16: (order_id, supplier_id) → plan_code is not preserved. No key of order_plan or warranty_plan stops an order from getting two plans of the same supplier; enforcing it needs a trigger or a check across the join.",
    ],
    source: [L(335, 347, "order_plan")],
    scriptCheck: { name: "3nf_to_bcnf_lossless / 3nf_to_bcnf_extra_rows", from: 944, to: 976, note: "Both report 0 in the script's own run." },
  },
  {
    id: "4nf-capability", stage: "4NF", title: "Split the independent multi-valued facts", method: "projection",
    original: { relation: "nf3_supplier_capability" },
    universe: ["supplier_id", "certification", "service_region"],
    parts: [
      { relation: "supplier_certification", attributes: ["supplier_id", "certification"] },
      { relation: "supplier_service_region", attributes: ["supplier_id", "service_region"] },
    ],
    notes: ["The script re-creates nf3_supplier_capability and its _check copy at lines 979–1016 because MySQL cannot open one temporary table twice in a statement (audit F6). The snapshot is a persistent table, so the lab joins it directly."],
    source: [L(349, 371, "supplier_certification, supplier_service_region")],
    scriptCheck: { name: "4nf_lossless_reconstruction", from: 1017, to: 1053, note: "Reports 0, and combined_rows = expected_rows for both suppliers." },
  },
];

export const decomposition = (id: string) => {
  const d = DECOMPOSITIONS.find((x) => x.id === id);
  if (!d) throw new Error(`Unknown decomposition ${id}`);
  return d;
};

/** FDs over a decomposition's universe: the original relation's design FDs plus the extra ones. */
export function universeFds(d: Decomposition): (FdLike & { basis: Basis; rationale: string })[] {
  const own = designFdsOf(d.original.relation).map((f) => ({ lhs: f.lhs, rhs: inter(f.rhs, d.universe), basis: f.basis, rationale: f.rationale }))
    .filter((f) => f.rhs.length && subset(f.lhs, d.universe));
  return [...own, ...(d.extraFds ?? [])];
}
export function universeMvds(d: Decomposition): MvdLike[] {
  return dependenciesOf(d.original.relation).filter((x) => x.kind === "mvd" && x.basis !== "observed-in-sample");
}

// ---------------------------------------------------------------- stages

export interface StageDefinition {
  id: NormalForm;
  index: number;
  title: string;
  /** The normal-form condition (formal). */
  definition: string;
  /** One-line plain-language statement of the rule. */
  rule: string;
  relations: string[];
  /** Relations of the previous stage that this stage decomposes. */
  inputs: string[];
  /** Relations this stage creates. */
  outputs: string[];
  decompositions: string[];
  summary: string;
  source: SourceRef[];
}

const BASE_3NF = ["postal_area", "customer", "supplier", "product", "sales_order", "order_line", "warranty_plan"];

export const STAGES: StageDefinition[] = [
  { id: "UNF", index: 0, title: "Unnormalised form",
    definition: "A relation is unnormalised when some attribute value is not atomic: a set, list or nested record.",
    rule: "Find attributes whose values are lists (repeating groups) or sets (multi-valued attributes).",
    relations: ["unf_customer", "unf_supplier", "unf_product", "unf_sales_order"], inputs: [], outputs: ["unf_customer", "unf_supplier", "unf_product", "unf_sales_order"], decompositions: [],
    summary: "Four session relations. unf_sales_order.items is a JSON repeating group of order lines; unf_supplier stores two JSON arrays.",
    source: [L(58, 128, "UNF relations and rows")] },
  { id: "1NF", index: 1, title: "First normal form",
    definition: "Every attribute value is atomic (no repeating groups or multi-valued attributes) and tuples are identified by a key.",
    rule: "Unnest every JSON array into rows; the key becomes the old key plus the item identifier.",
    relations: ["unf_customer", "unf_product", "nf1_order_line", "nf1_supplier_capability"], inputs: ["unf_sales_order", "unf_supplier"],
    outputs: ["nf1_order_line", "nf1_supplier_capability"], decompositions: ["1nf-order-items", "1nf-supplier-capability"],
    summary: "JSON_TABLE turns 3 orders with 4 items into 4 order-line rows, and 2 suppliers into 8 certification × region rows.",
    source: [L(130, 181, "nf1_*")] },
  { id: "2NF", index: 2, title: "Second normal form",
    definition: "1NF, and no non-prime attribute is functionally dependent on a proper subset of any candidate key.",
    rule: "Move every attribute that depends on part of a composite key into a relation keyed by that part.",
    relations: ["unf_customer", "nf2_order", "nf2_product", "nf2_order_line", "nf2_supplier_capability"], inputs: ["nf1_order_line", "nf1_supplier_capability"],
    outputs: ["nf2_order", "nf2_product", "nf2_order_line", "nf2_supplier_capability"], decompositions: ["2nf-order-line"],
    summary: "Order attributes depend on order_id alone and product attributes on product_id alone, so they move out of the line relation.",
    source: [L(183, 244, "nf2_*")] },
  { id: "3NF", index: 3, title: "Third normal form",
    definition: "For every non-trivial FD X → A that holds: X is a superkey, or A is a prime attribute.",
    rule: "Move every attribute that depends on a non-key attribute into a relation keyed by that attribute.",
    relations: [...BASE_3NF, "nf3_order_supplier_plan", "nf3_supplier_capability"], inputs: ["nf2_order", "nf2_product", "nf2_order_line", "nf2_supplier_capability"],
    outputs: [...BASE_3NF, "nf3_order_supplier_plan", "nf3_supplier_capability"], decompositions: ["3nf-order", "3nf-product", "3nf-order-line"],
    summary: "customer_id → customer, postal_code → city/region, supplier_id → supplier and plan_code → warranty each get their own relation.",
    source: [L(246, 333, "3NF relations")] },
  { id: "BCNF", index: 4, title: "Boyce–Codd normal form",
    definition: "For every non-trivial FD X → Y that holds: X is a superkey.",
    rule: "Split on any determinant that is not a superkey, even when its dependent attribute is prime.",
    relations: [...BASE_3NF, "order_plan", "nf3_supplier_capability"], inputs: ["nf3_order_supplier_plan"],
    outputs: ["order_plan", "warranty_plan"], decompositions: ["bcnf-plan"],
    summary: "plan_code → supplier_id has a determinant that is not a key of nf3_order_supplier_plan, so it splits into order_plan and warranty_plan.",
    source: [L(335, 347, "order_plan")] },
  { id: "4NF", index: 5, title: "Fourth normal form",
    definition: "For every non-trivial multivalued dependency X ↠ Y that holds: X is a superkey.",
    rule: "Separate independent multi-valued facts about the same key into their own relations.",
    relations: [...BASE_3NF, "order_plan", "supplier_certification", "supplier_service_region"], inputs: ["nf3_supplier_capability"],
    outputs: ["supplier_certification", "supplier_service_region"], decompositions: ["4nf-capability"],
    summary: "supplier_id ↠ certification | service_region: certifications and regions move to separate relations, and the cross product disappears.",
    source: [L(349, 371, "supplier_certification, supplier_service_region"), L(979, 1053, "4NF verification")] },
];

export const stage = (id: NormalForm) => STAGES.find((s) => s.id === id)!;

// ============================================================== structural (proof)

export interface StructuralResult {
  decompositionId: string;
  claim: "proof";
  method: "unnest" | "binary" | "chase";
  lossless: boolean;
  /** Plain-language argument (unnest) or the computed steps (projection). */
  argument: string[];
  binarySteps: BinaryStep[];
  chase: ChaseResult | null;
  preservation: { applicable: boolean; preserved: boolean; items: PreservationItem[]; note: string };
  /** Bases of every dependency the proof relies on: the proof holds only if these hold. */
  assumptions: { dependency: string; basis: Basis; rationale: string }[];
  /** The violation this decomposition removes, computed on the original relation. */
  removes: NfViolation[];
}

export function structuralProof(d: Decomposition): StructuralResult {
  const fds = universeFds(d);
  const mvds = universeMvds(d);
  const origAnalysis = analyzeRelation(relation(d.original.relation), DEPENDENCIES);
  const removes = origAnalysis.violations.filter((v) => v.nf === d.stage);
  const assumptions = [
    ...fds.map((f) => ({ dependency: fmtFd(f.lhs, f.rhs), basis: f.basis, rationale: f.rationale })),
    ...dependenciesOf(d.original.relation).filter((x) => x.kind === "mvd").map((m) => ({ dependency: fmtMvd(m.lhs, m.rhs), basis: m.basis, rationale: m.rationale })),
  ];
  if (d.method === "unnest") {
    return {
      decompositionId: d.id, claim: "proof", method: "unnest", lossless: true, argument: d.unnest!.argument, binarySteps: [], chase: null,
      preservation: { applicable: false, preserved: true, items: [], note: "Not a projection: unnesting restructures values. Every FD of the order and its items still holds inside the single 1NF relation." },
      assumptions, removes,
    };
  }
  const parts = d.parts.map((p) => ({ label: p.relation, attributes: p.attributes }));
  const ch = chase(d.universe, parts, fds, mvds);
  const steps = binarySteps(d.universe, parts, fds, mvds);
  const items = preservation(parts, fds);
  const binaryOk = steps.every((s) => s.determines !== null);
  return {
    decompositionId: d.id, claim: "proof", method: parts.length === 2 ? "binary" : "chase",
    lossless: ch.holds && (parts.length !== 2 || binaryOk),
    argument: parts.length === 2
      ? [`Binary decomposition: lossless iff R${sub(1)} ∩ R${sub(2)} → R${sub(1)} or R${sub(1)} ∩ R${sub(2)} → R${sub(2)} (FDs), or R${sub(1)} ∩ R${sub(2)} ↠ R${sub(1)} − R${sub(2)} (MVDs, Fagin).`]
      : [`${parts.length}-way decomposition: the chase tableau reaches a row of distinguished symbols (a) iff the join is lossless.`,
         "The binary steps show one join order in which every step satisfies the common-attribute criterion."],
    binarySteps: steps,
    chase: ch,
    preservation: {
      applicable: true,
      preserved: items.every((i) => i.preserved),
      items,
      note: fds.length === 0
        ? "No non-trivial FDs to preserve. The MVD is represented by the join itself."
        : items.every((i) => i.preserved)
          ? "Every FD can be enforced inside single relations (by their keys)."
          : "Some FDs span relations: no single relation's key can enforce them after the split.",
    },
    assumptions, removes,
  };
}

// ============================================================== instances (evidence)

export type Row = Record<string, unknown>;
/** Rows per relation NAME (not table). */
export type Sample = Record<string, Row[]>;

/** Canonical text of a value: DECIMAL strings and JSON numbers compare equal ("44000.00" ≡ 44000). */
export function canon(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  // Leading zeros are significant (phone numbers, postal codes): only plain decimals are normalised.
  if (typeof v === "string") return /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v) ? String(Number(v)) : v;
  return JSON.stringify(v);
}
const tupleKey = (r: Row, attrs: readonly string[]) => attrs.map((a) => canon(r[a])).join("␟");

function project(rows: Row[], attrs: readonly string[], columns: Record<string, string> = {}): Row[] {
  const seen = new Map<string, Row>();
  for (const r of rows) {
    const t: Row = {};
    for (const a of attrs) t[a] = r[columns[a] ?? a];
    seen.set(tupleKey(t, attrs), t);
  }
  return [...seen.values()];
}

function naturalJoin(a: Row[], aAttrs: readonly string[], b: Row[], bAttrs: readonly string[]): { rows: Row[]; attrs: string[] } {
  const shared = inter(aAttrs, bAttrs);
  const index = new Map<string, Row[]>();
  for (const r of b) { const k = tupleKey(r, shared); index.set(k, [...(index.get(k) ?? []), r]); }
  const out: Row[] = [];
  for (const r of a) for (const s of index.get(tupleKey(r, shared)) ?? []) out.push({ ...s, ...r });
  return { rows: out, attrs: uniq([...aAttrs, ...bAttrs]) };
}

const parseJsonArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === "string" ? (JSON.parse(v) as unknown[]) : []);

/** The UNF order items exactly as JSON_TABLE … JOIN unf_product (lines 152–164) produces them. */
export function unnestOrderItems(sample: Sample): Row[] {
  const products = new Map((sample.unf_product ?? []).map((p) => [canon(p.product_id), p]));
  const out: Row[] = [];
  for (const o of sample.unf_sales_order ?? []) {
    for (const raw of parseJsonArray(o.items)) {
      const it = raw as Row;
      const p = products.get(canon(it.product_id));
      if (!p) continue;
      out.push({
        order_id: o.order_id, product_id: it.product_id, order_date: o.order_date, customer_id: o.customer_id,
        customer_name: o.customer_name, customer_email: o.customer_email, postal_code: o.postal_code, city: o.city, region: o.region,
        product_name: p.product_name, supplier_id: p.supplier_id, supplier_name: p.supplier_name, supplier_phone: p.supplier_phone,
        product_list_price: p.list_price, quantity: it.quantity, unit_price: it.unit_price, plan_code: it.plan_code, warranty_months: it.warranty_months,
      });
    }
  }
  return out;
}

/** certifications × service_regions per supplier, as lines 173–181 produce them. */
export function unnestSupplierCapability(sample: Sample): Row[] {
  const out: Row[] = [];
  for (const s of sample.unf_supplier ?? []) {
    for (const c of parseJsonArray(s.certifications)) for (const r of parseJsonArray(s.service_regions)) {
      out.push({ supplier_id: s.supplier_id, certification: c, service_region: r });
    }
  }
  return out;
}

export interface Reconstruction { original: Row[]; reconstructed: Row[]; missing: Row[]; spurious: Row[] }

/** Rebuild the original relation from the decomposed relations (natural join of projections) and diff it. */
export function reconstruct(d: Decomposition, sample: Sample): Reconstruction {
  const U = d.universe;
  let original: Row[];
  let reconstructed: Row[];
  if (d.method === "unnest") {
    original = project(d.unnest!.builder === "order-items" ? unnestOrderItems(sample) : unnestSupplierCapability(sample), U);
    const p = d.parts[0]!;
    reconstructed = project(sample[p.relation] ?? [], U, p.columns);
  } else {
    const aug = d.original.augment;
    const base = relation(d.original.relation).attributes;
    const baseAttrs = inter(base, U);
    let orig = { rows: project(sample[d.original.relation] ?? [], baseAttrs), attrs: baseAttrs };
    if (aug) {
      const augAttrs = uniq([...aug.on, ...aug.attributes]);
      orig = naturalJoin(orig.rows, orig.attrs, project(sample[aug.relation] ?? [], augAttrs), augAttrs);
    }
    original = project(orig.rows, U);
    let acc: { rows: Row[]; attrs: string[] } | null = null;
    for (const p of d.parts) {
      const rows = project(sample[p.relation] ?? [], p.attributes, p.columns);
      acc = acc ? naturalJoin(acc.rows, acc.attrs, rows, p.attributes) : { rows, attrs: [...p.attributes] };
    }
    reconstructed = project(acc!.rows, U);
  }
  const ok = new Set(original.map((r) => tupleKey(r, U)));
  const rk = new Set(reconstructed.map((r) => tupleKey(r, U)));
  return {
    original, reconstructed,
    missing: original.filter((r) => !rk.has(tupleKey(r, U))),
    spurious: reconstructed.filter((r) => !ok.has(tupleKey(r, U))),
  };
}

/** Groups of tuples that agree on X but disagree on Y. */
export function fdViolations(rows: Row[], lhs: readonly string[], rhs: readonly string[]): { lhs: string; values: string[] }[] {
  const groups = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = tupleKey(r, lhs);
    const set = groups.get(k) ?? new Set<string>();
    set.add(tupleKey(r, rhs));
    groups.set(k, set);
  }
  return [...groups.entries()].filter(([, v]) => v.size > 1).map(([k, v]) => ({ lhs: k, values: [...v] }));
}

/** Count of (X, Y, Z) combinations required by X ↠ Y | Z that are absent from the instance. */
export function mvdViolations(rows: Row[], lhs: readonly string[], rhs: readonly string[], all: readonly string[]): number {
  const rest = minus(minus(all, lhs), rhs);
  const groups = new Map<string, { ys: Set<string>; zs: Set<string>; pairs: Set<string> }>();
  for (const r of rows) {
    const k = tupleKey(r, lhs);
    const g = groups.get(k) ?? { ys: new Set(), zs: new Set(), pairs: new Set() };
    const y = tupleKey(r, rhs), z = tupleKey(r, rest);
    g.ys.add(y); g.zs.add(z); g.pairs.add(`${y}␞${z}`);
    groups.set(k, g);
  }
  let missing = 0;
  for (const g of groups.values()) missing += g.ys.size * g.zs.size - g.pairs.size;
  return missing;
}

// ---------------------------------------------------------------- SQL (run on the teaching schema)

const qi = (name: string) => {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return "`" + name + "`";
};
const tableOf = (name: string) => qi(relation(name).table);
const colExpr = (rel: string, col: string, alias: string) =>
  (relation(rel).nonAtomic ?? []).includes(col) ? `CAST(${alias}.${qi(col)} AS CHAR)` : `${alias}.${qi(col)}`;

export function fdSql(rel: string, lhs: readonly string[], rhs: readonly string[]): string {
  return [
    "SELECT COUNT(*) AS violations FROM (",
    `  SELECT ${lhs.map((a) => `t.${qi(a)}`).join(", ")}`,
    `  FROM ${tableOf(rel)} t`,
    `  GROUP BY ${lhs.map((a) => `t.${qi(a)}`).join(", ")}`,
    `  HAVING COUNT(DISTINCT ${rhs.map((a) => colExpr(rel, a, "t")).join(", ")}) > 1`,
    ") v",
  ].join("\n");
}
export function keySql(rel: string, key: readonly string[]): string {
  return [
    "SELECT COUNT(*) AS violations FROM (",
    `  SELECT ${key.map(qi).join(", ")} FROM ${tableOf(rel)}`,
    `  GROUP BY ${key.map(qi).join(", ")} HAVING COUNT(*) > 1`,
    ") v",
  ].join("\n");
}
export function mvdSql(rel: string, lhs: readonly string[], rhs: readonly string[]): string {
  const all = relation(rel).attributes;
  const rest = minus(minus(all, lhs), rhs);
  const sel = [...lhs.map((a) => `y.${qi(a)}`), ...rhs.map((a) => `y.${qi(a)}`), ...rest.map((a) => `z.${qi(a)}`)];
  return [
    "SELECT COUNT(*) AS violations FROM (",
    `  SELECT DISTINCT ${sel.join(", ")}`,
    `  FROM ${tableOf(rel)} y JOIN ${tableOf(rel)} z ON ${lhs.map((a) => `z.${qi(a)} = y.${qi(a)}`).join(" AND ")}`,
    ") x",
    `WHERE NOT EXISTS (SELECT 1 FROM ${tableOf(rel)} t WHERE ${all.map((a) => `t.${qi(a)} = x.${qi(a)}`).join(" AND ")})`,
  ].join("\n");
}

const UNNEST_ITEMS_SQL = `SELECT o.order_id, j.product_id, o.order_date, o.customer_id, o.customer_name, o.customer_email,
         o.postal_code, o.city, o.region, p.product_name, p.supplier_id, p.supplier_name,
         p.supplier_phone, p.list_price AS product_list_price, j.quantity, j.unit_price, j.plan_code, j.warranty_months
  FROM \`unf_sales_order\` o
  CROSS JOIN JSON_TABLE(o.items, '$[*]' COLUMNS (
      product_id INT PATH '$.product_id',
      quantity INT PATH '$.quantity',
      unit_price DECIMAL(12,2) PATH '$.unit_price',
      plan_code VARCHAR(24) PATH '$.plan_code',
      warranty_months INT PATH '$.warranty_months')) j
  JOIN \`unf_product\` p ON p.product_id = j.product_id`;
const UNNEST_CAPABILITY_SQL = `SELECT s.supplier_id, c.certification, r.service_region
  FROM \`unf_supplier\` s
  CROSS JOIN JSON_TABLE(s.certifications, '$[*]' COLUMNS (certification VARCHAR(50) PATH '$')) c
  CROSS JOIN JSON_TABLE(s.service_regions, '$[*]' COLUMNS (service_region VARCHAR(80) PATH '$')) r`;

/** SELECT producing the original relation over U (canonical attribute names). */
export function originalSelectSql(d: Decomposition): string {
  if (d.method === "unnest") return d.unnest!.builder === "order-items" ? UNNEST_ITEMS_SQL : UNNEST_CAPABILITY_SQL;
  const aug = d.original.augment;
  const base = relation(d.original.relation).attributes;
  const cols = d.universe.map((a) => (base.includes(a) ? `o.${qi(a)}` : `a.${qi(a)} AS ${qi(a)}`));
  const from = `FROM ${tableOf(d.original.relation)} o` + (aug
    ? `\n  JOIN ${tableOf(aug.relation)} a ON ${aug.on.map((c) => `a.${qi(c)} = o.${qi(c)}`).join(" AND ")}` : "");
  return `SELECT DISTINCT ${cols.join(", ")}\n  ${from}`;
}

/** SELECT producing the natural join of the decomposed relations over U. */
export function joinSelectSql(d: Decomposition): string {
  const provider = new Map<string, { alias: string; col: string }>();
  const lines: string[] = [];
  d.parts.forEach((p, i) => {
    const alias = `r${i + 1}`;
    const col = (a: string) => p.columns?.[a] ?? a;
    if (i === 0) lines.push(`FROM ${tableOf(p.relation)} ${alias}`);
    else {
      const on = p.attributes.filter((a) => provider.has(a)).map((a) => `${alias}.${qi(col(a))} = ${provider.get(a)!.alias}.${qi(provider.get(a)!.col)}`);
      lines.push(on.length ? `JOIN ${tableOf(p.relation)} ${alias} ON ${on.join(" AND ")}` : `CROSS JOIN ${tableOf(p.relation)} ${alias}`);
    }
    for (const a of p.attributes) if (!provider.has(a)) provider.set(a, { alias, col: col(a) });
  });
  const sel = d.universe.map((a) => {
    const p = provider.get(a)!;
    return p.col === a ? `${p.alias}.${qi(a)}` : `${p.alias}.${qi(p.col)} AS ${qi(a)}`;
  });
  return `SELECT DISTINCT ${sel.join(", ")}\n  ${lines.join("\n  ")}`;
}

/** One statement returning original_rows, reconstructed_rows, missing and spurious tuple counts. */
export function reconstructionSql(d: Decomposition): string {
  const eq = (x: string, y: string) => d.universe.map((a) => `${y}.${qi(a)} <=> ${x}.${qi(a)}`).join(" AND ");
  const label = d.method === "unnest" ? "rebuilt by unnesting the UNF relation" : `the ${d.original.relation} instance over U`;
  return [
    `-- original: ${label}; reconstructed: what the decomposed relations give back`,
    "WITH original AS (",
    `  ${originalSelectSql(d)}`,
    "), reconstructed AS (",
    `  ${d.method === "unnest" ? `SELECT DISTINCT ${d.universe.map(qi).join(", ")}\n  FROM ${tableOf(d.parts[0]!.relation)}` : joinSelectSql(d)}`,
    ")",
    "SELECT",
    "  (SELECT COUNT(*) FROM original) AS original_rows,",
    "  (SELECT COUNT(*) FROM reconstructed) AS reconstructed_rows,",
    `  (SELECT COUNT(*) FROM original o WHERE NOT EXISTS (SELECT 1 FROM reconstructed r WHERE ${eq("o", "r")})) AS missing,`,
    `  (SELECT COUNT(*) FROM reconstructed r WHERE NOT EXISTS (SELECT 1 FROM original o WHERE ${eq("r", "o")})) AS spurious`,
  ].join("\n");
}

// ---------------------------------------------------------------- stage verification

export interface InstanceCheck {
  id: string;
  stage: NormalForm;
  kind: "reconstruction" | "fd" | "key" | "mvd";
  claim: "evidence";
  label: string;
  relation: string;
  basis?: Basis;
  decompositionId?: string;
  sql: string;
  /** Computed in memory from the loaded rows. */
  violations: number;
  /** The same check executed as SQL on the snapshot (null until run). */
  sqlViolations: number | null;
  detail: { originalRows?: number; reconstructedRows?: number; missing?: number; spurious?: number; rows?: number; examples?: string[] };
}

export interface StageReport {
  stage: NormalForm;
  structural: StructuralResult[];
  analyses: RelationAnalysis[];
  checks: InstanceCheck[];
  totals: { checks: number; violations: number; sqlViolations: number | null; sqlAgrees: boolean | null };
  /** Always states the limits of the sample checks. */
  disclaimer: string;
}

export const EVIDENCE_DISCLAIMER =
  "Instance checks run on the sample rows only. Zero violations shows this sample is consistent with the dependencies and that this decomposition loses nothing for this sample. It is evidence, not proof: another legal instance could still break an assumed dependency. The lossless-join and preservation results above are structural and hold for every instance that satisfies the stated dependencies.";

function checksForRelation(stageId: NormalForm, rel: string, sample: Sample): InstanceCheck[] {
  const schema = relation(rel);
  const rows = sample[rel] ?? [];
  const analysis = analyzeRelation(schema, DEPENDENCIES);
  const out: InstanceCheck[] = [];
  for (const k of analysis.keys) {
    const groups = fdViolations(rows.map((r, i) => ({ ...r, __row: i })), k, ["__row"]);
    out.push({ id: `${stageId}:${rel}:key:${k.join(",")}`, stage: stageId, kind: "key", claim: "evidence", relation: rel,
      label: `${rel}: key ${fmtSet(k)} is unique`, sql: keySql(rel, k), violations: groups.length, sqlViolations: null,
      detail: { rows: rows.length } });
  }
  for (const d of dependenciesOf(rel)) {
    if (d.kind === "fd") {
      const v = fdViolations(rows, d.lhs, d.rhs);
      out.push({ id: `${stageId}:${d.id}`, stage: stageId, kind: "fd", claim: "evidence", relation: rel, basis: d.basis,
        label: `${rel}: ${fmtFd(d.lhs, d.rhs)}`, sql: fdSql(rel, d.lhs, d.rhs), violations: v.length, sqlViolations: null,
        detail: { rows: rows.length, examples: v.slice(0, 3).map((x) => `${x.lhs} ↦ ${x.values.join(" / ")}`) } });
    } else {
      out.push({ id: `${stageId}:${d.id}`, stage: stageId, kind: "mvd", claim: "evidence", relation: rel, basis: d.basis,
        label: `${rel}: ${fmtMvd(d.lhs, d.rhs)}`, sql: mvdSql(rel, d.lhs, d.rhs),
        violations: mvdViolations(rows, d.lhs, d.rhs, schema.attributes), sqlViolations: null, detail: { rows: rows.length } });
    }
  }
  return out;
}

/** Pure: verify one stage against an in-memory sample (structural results do not depend on the sample). */
export function verifyStage(id: NormalForm, sample: Sample): StageReport {
  const st = stage(id);
  const rels = uniq([...st.inputs, ...st.outputs, ...st.relations]);
  const checks: InstanceCheck[] = [];
  for (const decId of st.decompositions) {
    const d = decomposition(decId);
    const r = reconstruct(d, sample);
    checks.push({ id: `${id}:${decId}:reconstruction`, stage: id, kind: "reconstruction", claim: "evidence", relation: d.original.relation,
      decompositionId: decId, label: d.method === "unnest" ? `${d.parts[0]!.relation} = unnest(${d.original.relation})` : `${d.parts.map((p) => p.relation).join(" ⋈ ")} = ${d.original.relation}`,
      sql: reconstructionSql(d), violations: r.missing.length + r.spurious.length, sqlViolations: null,
      detail: { originalRows: r.original.length, reconstructedRows: r.reconstructed.length, missing: r.missing.length, spurious: r.spurious.length,
        examples: [...r.missing.map((x) => `missing ${tupleKey(x, d.universe)}`), ...r.spurious.map((x) => `spurious ${tupleKey(x, d.universe)}`)].slice(0, 4) } });
  }
  for (const rel of rels) checks.push(...checksForRelation(id, rel, sample));
  return {
    stage: id,
    structural: st.decompositions.map((x) => structuralProof(decomposition(x))),
    analyses: rels.map((r) => analyzeRelation(relation(r), DEPENDENCIES)),
    checks,
    totals: { checks: checks.length, violations: checks.reduce((s, c) => s + c.violations, 0), sqlViolations: null, sqlAgrees: null },
    disclaimer: EVIDENCE_DISCLAIMER,
  };
}

/** Every relation the lab reads, keyed by relation name. */
export const SAMPLE_RELATIONS = Object.keys(RELATIONS);

/** Load every stage relation's rows from the teaching snapshot (SELECT only). */
export async function loadSample(pool: Pool): Promise<Sample> {
  const out: Sample = {};
  await Promise.all(SAMPLE_RELATIONS.map(async (name) => {
    const r = relation(name);
    const order = (r.declaredKeys[0] ?? r.attributes).map(qi).join(", ");
    const [rows] = await pool.query(`SELECT ${r.attributes.map(qi).join(", ")} FROM ${qi(r.table)} ORDER BY ${order}`);
    out[name] = rows as Row[];
  }));
  return out;
}

/** Execute each check's SQL on the snapshot and record the result next to the in-memory one. */
export async function runSqlChecks(pool: Pool, report: StageReport): Promise<StageReport> {
  const checks = await Promise.all(report.checks.map(async (c) => {
    const [rows] = await pool.query(c.sql);
    const row = (rows as Record<string, unknown>[])[0] ?? {};
    const sqlViolations = c.kind === "reconstruction" ? Number(row.missing) + Number(row.spurious) : Number(row.violations);
    return { ...c, sqlViolations };
  }));
  const sqlViolations = checks.reduce((s, c) => s + (c.sqlViolations ?? 0), 0);
  return {
    ...report, checks,
    totals: { ...report.totals, sqlViolations, sqlAgrees: checks.every((c) => c.sqlViolations === c.violations) },
  };
}

// ---------------------------------------------------------------- demonstrations (pure, in memory)

export interface Demonstration { title: string; claim: "evidence" | "counterexample" | "simulation"; result: number; explanation: string }

/**
 * F16 made concrete: two instances that satisfy every key of order_plan and warranty_plan,
 * whose join violates (order_id, supplier_id) → plan_code. Shows the lost dependency is real.
 */
export function bcnfCounterexample(sample: Sample): Demonstration {
  const wp = [...project(sample.warranty_plan ?? [], ["plan_code", "supplier_id"]), { plan_code: "CEDAR60", supplier_id: 10 }];
  const op = [...project(sample.order_plan ?? [], ["order_id", "plan_code"]), { order_id: 5001, plan_code: "CEDAR60" }];
  const keysOk = fdViolations(wp, ["plan_code"], ["supplier_id"]).length === 0 && new Set(op.map((r) => tupleKey(r, ["order_id", "plan_code"]))).size === op.length;
  const joined = naturalJoin(op, ["order_id", "plan_code"], wp, ["plan_code", "supplier_id"]).rows;
  const v = fdViolations(joined, ["order_id", "supplier_id"], ["plan_code"]).length;
  return {
    title: "Why (order_id, supplier_id) → plan_code is lost",
    claim: "counterexample",
    result: v,
    explanation: `Add plan CEDAR60 for supplier 10 to warranty_plan and (5001, CEDAR60) to order_plan. Every key still holds (${keysOk ? "checked" : "NOT satisfied"}), yet order 5001 now has ${v === 1 ? "two plans" : `${v} conflicting groups`} for supplier 10 in the join. Only a constraint across both relations could reject it.`,
  };
}

/** Audit F2: the script's 2NF → 3NF order check runs after sp_confirm_order(5001). Simulate that ordering. */
export function simulateF2(sample: Sample): Demonstration {
  const after: Sample = { ...sample, sales_order: (sample.sales_order ?? []).map((r) => (canon(r.order_id) === "5001" ? { ...r, order_status: "confirmed" } : r)) };
  const r = reconstruct(decomposition("3nf-order"), after);
  const before = reconstruct(decomposition("3nf-order"), sample);
  const mismatchedOrders = new Set(r.missing.map((x) => canon(x.order_id))).size;
  return {
    title: "Audit F2: the script's nf2_to_3nf_order_lossless reports 1",
    claim: "simulation",
    result: mismatchedOrders,
    explanation: `On the pre-demo snapshot the reconstruction has ${before.missing.length + before.spurious.length} differences. Applying sp_confirm_order(5001)'s status change (placed → confirmed) first, as the script does at line 849, gives ${r.missing.length} missing and ${r.spurious.length} spurious tuple(s): ${mismatchedOrders} mismatched order, the 1 the script reports. The cause is the order of operations, not the design.`,
  };
}

// ---------------------------------------------------------------- everything at once

export interface NormalizationLabData {
  sample: Sample;
  reports: StageReport[];
  demonstrations: { bcnf: Demonstration; f2: Demonstration };
  totals: { checks: number; violations: number; sqlViolations: number; sqlAgrees: boolean };
}

/** Load the snapshot, verify every stage in memory, run every check's SQL, and attach the demonstrations. */
export async function verifyAll(pool: Pool): Promise<NormalizationLabData> {
  const sample = await loadSample(pool);
  const reports: StageReport[] = [];
  for (const st of STAGES) reports.push(await runSqlChecks(pool, verifyStage(st.id, sample)));
  return {
    sample, reports,
    demonstrations: { bcnf: bcnfCounterexample(sample), f2: simulateF2(sample) },
    totals: {
      checks: reports.reduce((s, r) => s + r.totals.checks, 0),
      violations: reports.reduce((s, r) => s + r.totals.violations, 0),
      sqlViolations: reports.reduce((s, r) => s + (r.totals.sqlViolations ?? 0), 0),
      sqlAgrees: reports.every((r) => r.totals.sqlAgrees === true),
    },
  };
}
