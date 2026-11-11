"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ProductConfigurator } from "@/components/product-configurator";
import { FurnitureGlyph } from "@/components/furniture-glyph";
import { Price, StockBadge } from "@/components/product-bits";
import { formatPrice, titleCase } from "@/lib/format";
import type { Product3D } from "@/lib/server/catalog-3d";

const MAX_COMPARE = 3;

export function Studio({ products, initialId }: { products: Product3D[]; initialId: number }) {
  const [activeId, setActiveId] = useState(initialId);
  const [compare, setCompare] = useState<number[]>([initialId]);
  const [category, setCategory] = useState<string>("all");
  const active = products.find((p) => p.productId === activeId) ?? products[0]!;
  const categories = useMemo(() => ["all", ...new Set(products.map((p) => p.category ?? "other"))], [products]);
  const visible = products.filter((p) => category === "all" || p.category === category);

  const toggleCompare = (id: number) =>
    setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= MAX_COMPARE ? c : [...c, id]));
  const compared = compare.map((id) => products.find((p) => p.productId === id)).filter((p): p is Product3D => !!p);

  return (
    <div className="mt-10 space-y-16">
      <section aria-label="Configurator" className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        {/* key: re-mount per product so its first finish is preselected */}
        <ProductConfigurator key={active.productId} productId={active.productId} name={active.name} modelKey={active.modelKey} dimensions={active.dimensions}
          material={active.material} variants={active.variants} qtyOnHand={active.qtyOnHand} viewerClassName="aspect-[4/3]" />

        <div>
          <p className="eyebrow">{active.supplierName}</p>
          <h2 className="mt-2 text-4xl" data-testid="studio-active-name">{active.name}</h2>
          <div className="mt-4 flex flex-wrap items-center gap-3"><Price list={active.listPrice} offer={active.offerPrice} size="lg" /><StockBadge qty={active.qtyOnHand} /></div>
          {active.description && <p className="mt-4 text-sm leading-relaxed text-ink-soft">{active.description}</p>}
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={`/collection/${active.productId}`} className="btn btn-primary">Product details</Link>
            <button type="button" className="btn btn-ghost" aria-pressed={compare.includes(active.productId)} onClick={() => toggleCompare(active.productId)}
              disabled={!compare.includes(active.productId) && compare.length >= MAX_COMPARE}>
              {compare.includes(active.productId) ? "Remove from comparison" : "Add to comparison"}
            </button>
          </div>

          <div className="mt-10">
            <label className="eyebrow" htmlFor="studio-category">Browse pieces</label>
            <select id="studio-category" className="field mt-2" value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => <option key={c} value={c}>{c === "all" ? "All categories" : titleCase(c)}</option>)}
            </select>
            <ul className="mt-4 grid max-h-80 grid-cols-2 gap-2 overflow-y-auto pr-1" aria-label="Pieces">
              {visible.map((p) => (
                <li key={p.productId}>
                  <button type="button" onClick={() => setActiveId(p.productId)} aria-current={p.productId === activeId ? "true" : undefined}
                    data-testid="studio-piece"
                    className={`flex w-full items-center gap-2 rounded-xl border p-2 text-left text-xs transition-colors ${p.productId === activeId ? "border-charcoal bg-white/60" : "hairline hover:bg-white/40"}`}>
                    <FurnitureGlyph modelKey={p.modelKey} material={p.material} label={p.name} className="size-10 shrink-0" />
                    <span className="leading-snug">{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section aria-labelledby="compare-title">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="compare-title" className="text-3xl">Compare</h2>
            <p className="mt-1 text-sm text-ink-soft">Up to {MAX_COMPARE} pieces. Add the piece shown above, or tick pieces below.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {products.slice(0, 20).map((p) => (
              <label key={p.productId} className={`cursor-pointer rounded-full border px-3 py-1 text-xs has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brass ${compare.includes(p.productId) ? "border-charcoal bg-charcoal text-porcelain" : "hairline text-ink-soft"}`}>
                <input type="checkbox" className="sr-only" checked={compare.includes(p.productId)} onChange={() => toggleCompare(p.productId)}
                  disabled={!compare.includes(p.productId) && compare.length >= MAX_COMPARE} data-testid="compare-toggle" />
                {p.name}
              </label>
            ))}
          </div>
        </div>

        {compared.length === 0 ? (
          <p className="mt-6 text-sm text-ink-soft">Nothing selected for comparison.</p>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-2xl border hairline">
            <table className="w-full min-w-[560px] text-left text-sm" data-testid="compare-table">
              <thead>
                <tr className="bg-limestone/70">
                  <th scope="col" className="w-40 px-4 py-3 text-xs font-medium uppercase tracking-wider text-ink-soft">Attribute</th>
                  {compared.map((p) => (
                    <th key={p.productId} scope="col" className="px-4 py-3 font-display text-lg font-normal">
                      <FurnitureGlyph modelKey={p.modelKey} material={p.material} label={p.name} className="mb-2 h-16 w-24" />
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {([
                  ["Price", (p) => <Price list={p.listPrice} offer={p.offerPrice} />],
                  ["List price", (p) => formatPrice(p.listPrice)],
                  ["Dimensions (W×D×H)", (p) => (p.dimensions ? `${p.dimensions.widthCm} × ${p.dimensions.depthCm} × ${p.dimensions.heightCm} cm` : "—")],
                  ["Footprint", (p) => (p.dimensions ? `${((p.dimensions.widthCm * p.dimensions.depthCm) / 10000).toFixed(2)} m²` : "—")],
                  ["Material", (p) => p.material ?? "—"],
                  ["Finishes", (p) => (p.variants.length ? p.variants.map((v) => v.name).join(", ") : "Standard")],
                  ["Stock", (p) => <StockBadge qty={p.qtyOnHand} />],
                  ["Rating", (p) => (p.averageRating ? `${Number(p.averageRating).toFixed(1)} (${p.reviewCount})` : "No reviews")],
                  ["Supplier", (p) => p.supplierName],
                  ["Warranty", (p) => (p.warrantyMonths.length ? p.warrantyMonths.map((m) => `${m} mo`).join(", ") : "—")],
                ] as [string, (p: Product3D) => React.ReactNode][]).map(([label, cell]) => (
                  <tr key={label} className="border-t hairline">
                    <th scope="row" className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-ink-soft">{label}</th>
                    {compared.map((p) => <td key={p.productId} className="px-4 py-3">{cell(p)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
