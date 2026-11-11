import type { Metadata } from "next";
import Link from "next/link";
import { commerce, orders } from "@furni/database";
import { ReviewForm } from "./review-form";
import { db } from "@/lib/server/db";
import { can, requireSession } from "@/lib/server/auth";
import { formatDate, formatPrice, titleCase } from "@/lib/format";
import { EmptyState } from "@/components/product-bits";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-limestone text-ink-soft", placed: "bg-oat/60 text-charcoal", confirmed: "bg-sage/30 text-sage-deep",
  shipped: "bg-sage/30 text-sage-deep", delivered: "bg-charcoal text-porcelain", cancelled: "bg-clay/15 text-clay-deep",
};

export default async function Account() {
  const session = await requireSession("/account");
  const isCustomer = !!session.customerId && can(session, "order:own:read");
  const [myOrders, loyalty, reviewable] = isCustomer
    ? await Promise.all([orders.listOrdersForCustomer(db(), session, session.customerId!), commerce.myLoyalty(db(), session), commerce.reviewablePieces(db(), session)])
    : [null, null, null];

  return (
    <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-10">
      <p className="eyebrow">Account</p>
      <h1 className="mt-3 text-5xl">{session.displayName}</h1>
      <p className="mt-3 text-sm text-ink-soft">
        {session.email} · {session.roles.map(titleCase).join(", ")}
        {session.customerId ? ` · customer #${session.customerId}` : ""}
        {session.supplierIds.length ? ` · supplier #${session.supplierIds.join(", #")}` : ""}
      </p>

      {myOrders && (
        <section className="mt-14" aria-labelledby="orders">
          <h2 id="orders" className="text-3xl">Your orders</h2>
          {myOrders.length === 0 ? (
            <div className="mt-6"><EmptyState title="No orders yet." body="When you buy a piece, it will appear here with its full status history."
              action={<Link href="/collection" className="btn btn-ghost">Browse the collection</Link>} /></div>
          ) : (
            <div className="mt-6 overflow-x-auto rounded-2xl border hairline">
              <table className="w-full text-left text-sm" data-testid="orders-table">
                <thead className="bg-limestone/70 text-xs uppercase tracking-wider text-ink-soft">
                  <tr><th scope="col" className="px-4 py-3 font-medium">Order</th><th scope="col" className="px-4 py-3 font-medium">Date</th>
                    <th scope="col" className="px-4 py-3 font-medium">Items</th><th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Total</th></tr>
                </thead>
                <tbody>
                  {myOrders.map((o) => (
                    <tr key={o.orderId} className="border-t hairline">
                      <td className="px-4 py-3 font-mono"><Link href={`/orders/${o.orderId}`} className="underline underline-offset-4" data-testid="order-link">#{o.orderId}</Link></td>
                      <td className="px-4 py-3">{formatDate(o.orderDate)}</td>
                      <td className="px-4 py-3">{o.lineCount} line{o.lineCount === 1 ? "" : "s"}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs ${STATUS_STYLE[o.status] ?? ""}`}>{titleCase(o.status)}</span></td>
                      <td className="px-4 py-3 text-right font-display">{formatPrice(o.orderTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-ink-soft">Totals are SUM(order_line.line_total), a generated column in the original schema.</p>
        </section>
      )}

      {loyalty && (
        <section className="mt-14 grid gap-6 sm:grid-cols-[220px_1fr]" aria-labelledby="loyalty">
          <div className="rounded-3xl bg-charcoal p-6 text-porcelain">
            <p className="eyebrow !text-oat" id="loyalty">Loyalty points</p>
            <p className="mt-2 font-display text-5xl" data-testid="loyalty-points">{loyalty.points}</p>
            <p className="mt-1 text-xs text-oat">from {loyalty.deliveredOrders} delivered order{loyalty.deliveredOrders === 1 ? "" : "s"}</p>
          </div>
          <div className="text-sm">
            <p className="text-ink-soft">Points are awarded by the original procedure <code className="font-mono text-xs">sp_award_loyalty</code>: FLOOR(order total / 100) for each delivered order, once per order.</p>
            {loyalty.awards.length > 0 && (
              <ul className="mt-3 space-y-1">
                {loyalty.awards.map((a) => <li key={String(a.order_id)}>Order #{String(a.order_id)}: <strong>{String(a.points_awarded)}</strong> points <span className="text-ink-soft">· {String(a.awarded_at)}</span></li>)}
              </ul>
            )}
          </div>
        </section>
      )}

      {reviewable && reviewable.length > 0 && (
        <section className="mt-14" aria-labelledby="reviews">
          <h2 id="reviews" className="text-3xl">Review your pieces</h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {reviewable.map((p) => (
              <li key={p.productId} className="rounded-2xl border hairline p-5" data-testid="reviewable" data-product={p.productId}>
                <p className="font-display text-xl">{p.name}</p>
                {p.rating
                  ? <p className="mt-2 text-sm"><span className="text-brass">{"★".repeat(p.rating)}</span> {p.comment ? `“${p.comment}”` : ""}</p>
                  : <ReviewForm productId={p.productId} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!myOrders && (
        <section className="mt-14 grid gap-4 sm:grid-cols-2">
          {can(session, "order:any:read") && <Link href="/manage" className="rounded-2xl border hairline p-6 hover:bg-limestone/60"><p className="font-display text-2xl">Management</p><p className="mt-1 text-sm text-ink-soft">Orders, inventory and suppliers</p></Link>}
          {can(session, "supplier:own:read") && <Link href="/manage" className="rounded-2xl border hairline p-6 hover:bg-limestone/60"><p className="font-display text-2xl">Supplier portal</p><p className="mt-1 text-sm text-ink-soft">Your products and settlements</p></Link>}
          {can(session, "lab:read") && <Link href="/lab" className="rounded-2xl border hairline p-6 hover:bg-limestone/60"><p className="font-display text-2xl">Database Lab</p><p className="mt-1 text-sm text-ink-soft">Normalization, SQL, procedures</p></Link>}
        </section>
      )}
    </div>
  );
}
