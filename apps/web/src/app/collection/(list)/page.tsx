import type { Metadata } from "next";
import { catalog, productDetail } from "@furni/database";
import { asOfDate, db } from "@/lib/server/db";
import { EmptyState, ProductCard } from "@/components/product-bits";
import { titleCase } from "@/lib/format";

export const metadata: Metadata = { title: "Collection" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/** Keep valid fields and silently drop malformed ones. Validation itself is the repository's Zod schema. */
function parseFilters(sp: SP, asOf: string): { filter: catalog.CatalogFilter; raw: Record<string, string> } {
  const raw: Record<string, string> = {};
  for (const k of ["q", "category", "supplier", "min", "max", "stock", "sort"]) { const v = one(sp[k]); if (v) raw[k] = v; }
  const candidate = {
    q: raw.q, category: raw.category, supplierId: raw.supplier, minPrice: raw.min, maxPrice: raw.max,
    inStockOnly: raw.stock === "1" ? true : undefined, sort: raw.sort, asOf,
  };
  const filter: Record<string, unknown> = { asOf };
  for (const [k, v] of Object.entries(candidate)) {
    if (v === undefined || k === "asOf") continue;
    const ok = catalog.CatalogFilterSchema.safeParse({ asOf, [k]: v });
    if (ok.success) filter[k] = v; else delete raw[k === "supplierId" ? "supplier" : k === "minPrice" ? "min" : k === "maxPrice" ? "max" : k];
  }
  return { filter: filter as catalog.CatalogFilter, raw };
}

export default async function CollectionPage({ searchParams }: { searchParams: Promise<SP> }) {
  const asOf = asOfDate();
  const { filter, raw } = parseFilters(await searchParams, asOf);
  const [items, options] = await Promise.all([catalog.listProducts(db(), filter), productDetail.filterOptions(db())]);
  const hrefWith = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ ...raw, ...patch } as Record<string, string>);
    for (const [k, v] of [...p.entries()]) if (!v || v === "undefined") p.delete(k);
    const s = p.toString();
    return s ? `/collection?${s}` : "/collection";
  };
  const active = Object.keys(raw).filter((k) => k !== "sort").length > 0;

  // Filters are plain links and a native GET form: full document navigations that work without JavaScript.
  // (Client-router soft navigations between search-param variants of this page intermittently failed to
  // commit under Next 15.5 in e2e runs; see docs/database/TEST_RESULTS.md.)
  return (
    <div className="mx-auto max-w-7xl px-4 pb-10 pt-12 sm:px-6 lg:px-10">
      <header className="rise max-w-3xl">
        <p className="eyebrow">The collection</p>
        <h1 className="mt-3 text-5xl leading-[1.05] sm:text-6xl">Pieces made to be lived around.</h1>
        <p className="mt-4 max-w-xl text-ink-soft">
          Every listing, price, stock count and rating on this page is read live from the store database.
          Offers are priced with the original <code className="font-mono text-[0.85em]">fn_discounted_price</code> function, as of {asOf}.
        </p>
      </header>

      <nav aria-label="Categories" className="mt-10 flex flex-wrap gap-2">
        <a href={hrefWith({ category: undefined })} aria-current={!raw.category ? "page" : undefined}
          className={`rounded-full px-4 py-2 text-sm transition-colors ${!raw.category ? "bg-charcoal text-porcelain" : "bg-limestone text-ink-soft hover:text-charcoal"}`}>
          All
        </a>
        {options.categories.map((c) => (
          <a key={c.code} href={hrefWith({ category: c.code })} aria-current={raw.category === c.code ? "page" : undefined}
            className={`rounded-full px-4 py-2 text-sm transition-colors ${raw.category === c.code ? "bg-charcoal text-porcelain" : "bg-limestone text-ink-soft hover:text-charcoal"}`}>
            {c.name}
          </a>
        ))}
      </nav>

      {/* Keyed on the active filters so client navigation (e.g. "Clear filters") never leaves stale input values. */}
      <form key={JSON.stringify(raw)} method="get" action="/collection" role="search" aria-label="Filter the collection"
        className="mt-6 grid grid-cols-2 gap-3 rounded-2xl border hairline bg-white/40 p-4 lg:grid-cols-[2fr_1.2fr_0.8fr_0.8fr_1fr_auto]">
        {raw.category && <input type="hidden" name="category" value={raw.category} />}
        <label className="col-span-2 block lg:col-span-1">
          <span className="sr-only">Search</span>
          <input className="field" type="search" name="q" placeholder="Search name or material" defaultValue={raw.q} maxLength={80} />
        </label>
        <label className="col-span-2 block lg:col-span-1">
          <span className="sr-only">Supplier</span>
          <select className="field" name="supplier" defaultValue={raw.supplier ?? ""}>
            <option value="">All suppliers</option>
            {options.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">Minimum price (INR)</span>
          <input className="field" type="number" name="min" min={0} step={500} placeholder="Min ₹" defaultValue={raw.min} />
        </label>
        <label className="block">
          <span className="sr-only">Maximum price (INR)</span>
          <input className="field" type="number" name="max" min={0} step={500} placeholder="Max ₹" defaultValue={raw.max} />
        </label>
        <label className="col-span-2 block lg:col-span-1">
          <span className="sr-only">Sort</span>
          <select className="field" name="sort" defaultValue={raw.sort ?? "name"}>
            <option value="name">Name</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="rating">Rating</option>
          </select>
        </label>
        <div className="col-span-2 flex items-center justify-between gap-3 lg:col-span-1">
          <label className="flex items-center gap-2 whitespace-nowrap text-sm text-ink-soft">
            <input type="checkbox" name="stock" value="1" defaultChecked={raw.stock === "1"} className="size-4 accent-[#373a34]" />
            In stock
          </label>
          <button className="btn btn-primary h-11" type="submit">Apply</button>
        </div>
      </form>

      <div className="mt-8 flex items-center justify-between text-sm text-ink-soft">
        <p aria-live="polite" data-testid="result-count">
          {items.length} {items.length === 1 ? "piece" : "pieces"}{raw.category ? ` in ${titleCase(raw.category)}` : ""}
        </p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- deliberate full navigation, see note above */}
        {active && <a href="/collection" className="underline underline-offset-4 hover:text-charcoal">Clear filters</a>}
      </div>

      {items.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Nothing matches, yet." body="No piece fits every filter you chose. Widen the price range or clear a filter."
            // eslint-disable-next-line @next/next/no-html-link-for-pages -- deliberate full navigation, see note above
            action={<a href="/collection" className="btn btn-ghost">Clear filters</a>} />
        </div>
      ) : (
        <ul className="mt-6 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => <li key={item.productId}><ProductCard item={item} /></li>)}
        </ul>
      )}
    </div>
  );
}
