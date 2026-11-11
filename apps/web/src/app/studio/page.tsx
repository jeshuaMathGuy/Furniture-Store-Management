import type { Metadata } from "next";
import { asOfDate } from "@/lib/server/db";
import { allProductDetails } from "@/lib/server/catalog-3d";
import { Studio } from "@/components/studio/studio";

export const metadata: Metadata = { title: "Studio" };
export const dynamic = "force-dynamic";

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const products = await allProductDetails(asOfDate());
  const requested = Number((await searchParams).product);
  const initial = products.some((p) => p.productId === requested) ? requested : 102;
  return (
    <div className="mx-auto max-w-7xl px-4 pb-10 pt-12 sm:px-6 lg:px-10">
      <header className="rise max-w-3xl">
        <p className="eyebrow">Studio</p>
        <h1 className="mt-3 text-5xl leading-[1.05] sm:text-6xl">Configure, compare, commit.</h1>
        <p className="mt-4 max-w-xl text-ink-soft">
          Choose a piece, try its finishes in 3D, take it apart, and compare it with others. Every figure on this page comes from the store database.
        </p>
      </header>
      <Studio products={products} initialId={initial} />
    </div>
  );
}
