import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { productDetail, records } from "@furni/database";
import { asOfDate, db } from "@/lib/server/db";
import { can, getSession } from "@/lib/server/auth";
import { ProductConfigurator } from "@/components/product-configurator";
import { Price, ProductCard, ProvenanceTag, Rating, StockBadge } from "@/components/product-bits";
import { RecordInspector } from "@/components/record-inspector";
import { formatDate, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };

const parseId = (s: string) => (/^\d{1,9}$/.test(s) ? Number(s) : null);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = parseId((await params).id);
  const p = id ? await productDetail.getProduct(db(), id, asOfDate()) : null;
  return { title: p?.name ?? "Not found", description: p?.description ?? undefined };
}

export default async function ProductPage({ params }: Props) {
  const id = parseId((await params).id);
  if (!id) notFound();
  const asOf = asOfDate();
  const [p, session] = await Promise.all([productDetail.getProduct(db(), id, asOf), getSession()]);
  if (!p) notFound();
  const [related, record] = await Promise.all([
    productDetail.relatedProducts(db(), id, asOf),
    can(session, "product:manage") || can(session, "lab:read") ? records.productRecord(db(), session, id) : null,
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6 lg:px-10">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-soft">
        <ol className="flex flex-wrap gap-2">
          <li><Link href="/collection" className="hover:text-charcoal">Collection</Link> /</li>
          {p.category && <li><Link href={`/collection?category=${p.category}`} className="hover:text-charcoal">{titleCase(p.category)}</Link> /</li>}
          <li aria-current="page" className="text-charcoal">{p.name}</li>
        </ol>
      </nav>

      <div className="mt-8 grid gap-12 lg:grid-cols-[1.25fr_1fr]">
        <div className="rise">
          <ProductConfigurator productId={p.productId} name={p.name} modelKey={p.modelKey} dimensions={p.dimensions} material={p.material} variants={p.variants} qtyOnHand={p.qtyOnHand} />
        </div>

        <section aria-labelledby="product-title" className="rise [animation-delay:80ms]">
          <div className="flex flex-wrap items-center gap-2">
            <p className="eyebrow">{p.supplierName}{p.style ? ` · ${p.style}` : ""}</p>
            <ProvenanceTag source={p.provenance} />
          </div>
          <h1 id="product-title" className="mt-3 text-4xl leading-tight sm:text-5xl">{p.name}</h1>
          <div className="mt-3"><Rating value={p.averageRating} count={p.reviewCount} /></div>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Price list={p.listPrice} offer={p.offerPrice} size="lg" />
            <StockBadge qty={p.qtyOnHand} />
          </div>
          {p.offerName && (
            <p className="mt-2 text-sm text-clay-deep">
              {p.offerName}: {Number(p.discountPct)}% off until {formatDate(p.offerEnds!)}
            </p>
          )}
          {p.description && <p className="mt-6 leading-relaxed text-ink-soft">{p.description}</p>}

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={`/studio?product=${p.productId}`} className="btn btn-ghost">Compare in Studio</Link>
            <Link href={`/collection?category=${p.category ?? ""}`} className="btn btn-ghost">More {p.category ? titleCase(p.category).toLowerCase() : "pieces"}</Link>
          </div>
          <p className="mt-2 text-xs text-ink-soft">Choose a finish and quantity under the model. Stock is reserved when the warehouse confirms your order.</p>

          <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-4 border-t hairline pt-6 text-sm">
            {p.dimensions && (<>
              <dt className="text-ink-soft">Dimensions</dt>
              <dd>{p.dimensions.widthCm} W × {p.dimensions.depthCm} D × {p.dimensions.heightCm} H cm</dd>
            </>)}
            <dt className="text-ink-soft">Material</dt><dd>{p.material ?? "—"}</dd>
            <dt className="text-ink-soft">Warranty</dt>
            <dd>{p.warrantyMonths.length ? p.warrantyMonths.map((m) => `${m} months`).join(", ") : "Supplier standard"}</dd>
            <dt className="text-ink-soft">Maker certifications</dt><dd>{p.certifications.join(" · ") || "—"}</dd>
          </dl>
        </section>
      </div>

      <section aria-labelledby="reviews" className="mt-20 grid gap-10 lg:grid-cols-[1fr_2fr]">
        <div>
          <h2 id="reviews" className="text-3xl">Reviews</h2>
          <p className="mt-2 text-sm text-ink-soft">From verified customers in the store database.</p>
        </div>
        {p.reviews.length === 0 ? (
          <p className="text-sm text-ink-soft">No reviews yet for this piece.</p>
        ) : (
          <ul className="space-y-6">
            {p.reviews.map((r, i) => (
              <li key={i} className="border-b hairline pb-6">
                <p className="text-brass" aria-label={`${r.rating} out of 5`}>{"★".repeat(r.rating)}<span className="text-oat">{"★".repeat(5 - r.rating)}</span></p>
                {r.comment && <p className="mt-2 font-display text-xl leading-snug">“{r.comment}”</p>}
                <p className="mt-2 text-xs text-ink-soft">{r.customerFirstName} · {formatDate(r.date)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {record && (
        <section aria-labelledby="record" className="mt-20">
          <RecordInspector productId={p.productId} tables={record} />
        </section>
      )}

      {related.length > 0 && (
        <section aria-labelledby="related" className="mt-20">
          <h2 id="related" className="text-3xl">Pairs well with</h2>
          <ul className="mt-8 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((r) => <li key={r.productId}><ProductCard item={r} /></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
