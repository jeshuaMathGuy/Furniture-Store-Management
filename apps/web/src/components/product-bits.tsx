import Link from "next/link";
import type { catalog } from "@furni/database";
import { formatPrice, titleCase } from "@/lib/format";
import { FurnitureGlyph } from "./furniture-glyph";

type Item = catalog.CatalogItem;

export function Price({ list, offer, size = "md" }: { list: string; offer: string | null; size?: "md" | "lg" }) {
  const big = size === "lg" ? "text-3xl" : "text-base";
  if (!offer) return <span className={`${big} font-display`}>{formatPrice(list)}</span>;
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className={`${big} font-display text-clay-deep`}>{formatPrice(offer)}</span>
      <s className="text-sm text-ink-soft" aria-label={`was ${formatPrice(list)}`}>{formatPrice(list)}</s>
    </span>
  );
}

export function StockBadge({ qty }: { qty: number }) {
  const [label, cls] =
    qty <= 0 ? ["Made to order", "bg-limestone text-ink-soft"]
    : qty <= 3 ? [`Only ${qty} in stock`, "bg-clay/15 text-clay-deep"]
    : ["In stock", "bg-sage/25 text-sage-deep"];
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[0.7rem] font-medium tracking-wide ${cls}`}>{label}</span>;
}

export function Rating({ value, count }: { value: string | null; count: number }) {
  if (!value || count === 0) return <span className="text-xs text-ink-soft">No reviews yet</span>;
  return (
    <span className="text-xs text-ink-soft" aria-label={`Rated ${Number(value).toFixed(1)} out of 5 from ${count} review${count === 1 ? "" : "s"}`}>
      <span aria-hidden className="text-brass">{"★".repeat(Math.round(Number(value)))}</span>{" "}
      {Number(value).toFixed(1)} · {count}
    </span>
  );
}

export function ProvenanceTag({ source }: { source: Item["provenance"] }) {
  if (source !== "demo_seed") return null;
  return (
    <span title="Seeded demonstration record, not part of the original SQL dataset"
      className="rounded-full border border-dashed border-ink-soft/40 px-2 py-0.5 text-[0.65rem] uppercase tracking-wider text-ink-soft">
      Demo record
    </span>
  );
}

export function ProductCard({ item }: { item: Item }) {
  return (
    <article className="group relative flex flex-col" data-testid="product-card" data-category={item.category ?? ""}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-limestone transition-shadow duration-500 group-hover:shadow-lift">
        <FurnitureGlyph modelKey={item.modelKey} material={item.material} label={item.name}
          className="absolute inset-0 h-full w-full p-8 transition-transform duration-700 ease-[var(--ease-arch)] group-hover:scale-[1.04]" />
        {item.offerName && (
          <span className="absolute left-3 top-3 rounded-full bg-porcelain/90 px-2.5 py-1 text-[0.7rem] text-clay-deep">{item.offerName}</span>
        )}
      </div>
      <div className="mt-4 flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">{item.category ? titleCase(item.category) : "Furniture"} · {item.material}</p>
          <h3 className="mt-1 text-lg leading-snug">
            <Link href={`/collection/${item.productId}`} className="after:absolute after:inset-0 focus-visible:outline-none">
              {item.name}
            </Link>
          </h3>
        </div>
        <Price list={item.listPrice} offer={item.offerPrice} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StockBadge qty={item.qtyOnHand} />
        <Rating value={item.averageRating} count={item.reviewCount} />
        <ProvenanceTag source={item.provenance} />
      </div>
    </article>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed hairline px-6 py-16 text-center">
      <p className="font-display text-2xl">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
