import type { Metadata } from "next";
import Link from "next/link";
import { commerce } from "@furni/database";
import { asOfDate, db } from "@/lib/server/db";
import { can, requireSession } from "@/lib/server/auth";
import { FurnitureGlyph } from "@/components/furniture-glyph";
import { EmptyState } from "@/components/product-bits";
import { formatPrice } from "@/lib/format";
import { setQuantityAction } from "./actions";

export const metadata: Metadata = { title: "Cart" };
export const dynamic = "force-dynamic";

export default async function CartPage() {
  const session = await requireSession("/cart");
  if (!can(session, "cart:own") || !session.customerId) {
    return <EmptyState title="Carts are for customer accounts." body="Staff, supplier and student accounts can browse the collection, but only customers can buy." action={<Link href="/collection" className="btn btn-ghost">Browse the collection</Link>} />;
  }
  const cart = await commerce.getCart(db(), session, asOfDate());
  const savings = cart.lines.reduce((s, l) => s + (Number(l.unitPrice) * l.quantity - Number(l.lineTotal)), 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:px-10">
      <p className="eyebrow">Cart</p>
      <h1 className="mt-3 text-5xl">Your selection</h1>
      {cart.lines.length === 0 ? (
        <div className="mt-10"><EmptyState title="Your cart is empty." body="Pieces you add from the collection, Studio or showroom appear here." action={<Link href="/collection" className="btn btn-primary">Explore the collection</Link>} /></div>
      ) : (
        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_320px]">
          <ul className="divide-y hairline border-y hairline" data-testid="cart-lines">
            {cart.lines.map((l) => (
              <li key={l.productId} className="flex gap-4 py-5" data-testid="cart-line" data-product={l.productId}>
                <FurnitureGlyph modelKey={l.modelKey} material={l.material} color={l.colorHex ?? undefined} label={l.name} className="h-24 w-32 shrink-0 rounded-xl bg-limestone p-3" />
                <div className="flex-1">
                  <Link href={`/collection/${l.productId}`} className="font-display text-xl hover:underline">{l.name}</Link>
                  <p className="mt-1 text-sm text-ink-soft">
                    {l.variantName ?? l.material}{Number(l.priceDelta) > 0 ? ` (+${formatPrice(l.priceDelta)})` : ""} · {formatPrice(l.unitPrice)} each
                    {l.offerName && <span className="text-clay-deep"> · {l.offerName} −{Number(l.discountPct)}%</span>}
                  </p>
                  {!l.available && <p className="mt-1 text-sm text-clay-deep" role="alert">Only {Math.min(l.qtyOnHand, l.variantQtyOnHand ?? Infinity)} in stock. Reduce the quantity to check out.</p>}
                  <form action={setQuantityAction} className="mt-3 flex items-center gap-2">
                    <input type="hidden" name="productId" value={l.productId} />
                    <label className="text-sm text-ink-soft" htmlFor={`qty-${l.productId}`}>Qty</label>
                    <select id={`qty-${l.productId}`} name="quantity" defaultValue={l.quantity} className="field h-9 w-20">
                      {Array.from({ length: 20 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                    </select>
                    <button className="btn btn-ghost h-9 px-3 text-xs" type="submit">Update</button>
                    <button className="btn btn-ghost h-9 px-3 text-xs" type="submit" name="remove" value="1">Remove</button>
                  </form>
                </div>
                <p className="font-display text-lg">{formatPrice(l.lineTotal)}</p>
              </li>
            ))}
          </ul>
          <aside className="h-fit rounded-3xl border hairline bg-white/50 p-6">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-ink-soft">Items</dt><dd>{cart.itemCount}</dd></div>
              {savings > 0 && <div className="flex justify-between text-clay-deep"><dt>Offer savings</dt><dd>−{formatPrice(savings)}</dd></div>}
              <div className="flex justify-between"><dt className="text-ink-soft">Delivery</dt><dd>Included</dd></div>
              <div className="flex justify-between border-t hairline pt-3 text-base"><dt>Total</dt><dd className="font-display text-2xl" data-testid="cart-total">{formatPrice(cart.subtotal)}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-ink-soft">Prices and offers as of {asOfDate()}. The final total is recalculated by the database at checkout.</p>
            {cart.allAvailable
              ? <Link href="/checkout" className="btn btn-primary mt-6 w-full">Checkout</Link>
              : <button className="btn btn-primary mt-6 w-full" disabled>Checkout</button>}
          </aside>
        </div>
      )}
    </div>
  );
}
