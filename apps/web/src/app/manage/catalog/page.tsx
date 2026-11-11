import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { operations } from "@furni/database";
import { db } from "@/lib/server/db";
import { can, requireSession } from "@/lib/server/auth";
import { ActionForm } from "@/components/action-form";
import { formatPrice } from "@/lib/format";
import { createOfferAction, setPriceAction, toggleOfferAction, toggleProductAction } from "../actions";

export const metadata: Metadata = { title: "Catalogue · Management" };

export default async function CatalogPage() {
  const session = await requireSession("/manage/catalog");
  if (!can(session, "product:manage")) notFound();
  const [products, offers] = await Promise.all([operations.productAdminList(db(), session), operations.listOffers(db(), session)]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-14">
      <section>
        <h1 className="text-4xl">Catalogue</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">Price changes are audited by the original trigger au_product. The panel under each form shows the audit_log row it wrote.</p>
        <div className="mt-6 overflow-x-auto rounded-2xl border hairline">
          <table className="w-full min-w-[760px] text-left text-sm" data-testid="catalog-table">
            <thead className="bg-limestone/70 text-xs uppercase tracking-wider text-ink-soft">
              <tr>{["Product", "Supplier", "Stock", "List price", "Status"].map((h) => <th key={h} scope="col" className="px-4 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={String(p.product_id)} className="border-t hairline align-top" data-product={String(p.product_id)}>
                  <td className="px-4 py-3">{String(p.product_name)} <span className="text-ink-soft">#{String(p.product_id)}</span></td>
                  <td className="px-4 py-3">{String(p.supplier_name)}</td>
                  <td className="px-4 py-3 font-mono">{String(p.qty_on_hand)}</td>
                  <td className="px-4 py-3">
                    <ActionForm action={setPriceAction} submitLabel="Save" buttonClass="btn btn-ghost h-9 px-3 text-xs" className="flex flex-wrap items-center gap-2" testId="price-form">
                      <input type="hidden" name="productId" value={String(p.product_id)} />
                      <input name="price" type="number" step="0.01" min={0} defaultValue={String(p.list_price)} className="field h-9 w-32" aria-label={`List price for ${String(p.product_name)}`} />
                    </ActionForm>
                  </td>
                  <td className="px-4 py-3">
                    <ActionForm action={toggleProductAction} submitLabel={p.is_active ? "Hide" : "Activate"} buttonClass="btn btn-ghost h-9 px-3 text-xs">
                      <input type="hidden" name="productId" value={String(p.product_id)} />
                      <input type="hidden" name="active" value={p.is_active ? "0" : "1"} />
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-10 lg:grid-cols-[360px_1fr]">
        <div>
          <h2 className="text-2xl">New offer</h2>
          <ActionForm action={createOfferAction} submitLabel="Create offer" className="mt-4 space-y-2 rounded-2xl border hairline p-4" testId="offer-form">
            <select name="productId" className="field" required defaultValue="" aria-label="Product">
              <option value="" disabled>Product</option>
              {products.map((p) => <option key={String(p.product_id)} value={String(p.product_id)}>{String(p.product_name)}</option>)}
            </select>
            <input name="offerName" className="field" placeholder="Offer name" required minLength={3} />
            <input name="discountPct" type="number" step="0.01" min={0.01} max={100} className="field" placeholder="Discount %" required />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs">Starts<input type="date" name="startDate" className="field mt-1" defaultValue={today} required /></label>
              <label className="text-xs">Ends<input type="date" name="endDate" className="field mt-1" required /></label>
            </div>
            <p className="text-xs text-ink-soft">The original CHECK constraints (0–100 %, end ≥ start) are enforced by MySQL; their errors appear here verbatim.</p>
          </ActionForm>
        </div>
        <div>
          <h2 className="text-2xl">Offers</h2>
          <ul className="mt-4 space-y-2">
            {offers.map((o) => (
              <li key={String(o.offer_id)} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border hairline px-4 py-3 text-sm">
                <span><strong>{String(o.offer_name)}</strong> · {String(o.product_name)} · {Number(o.discount_pct)}% → {formatPrice(String(o.offer_price))} · {String(o.start_date)} to {String(o.end_date)}</span>
                <ActionForm action={toggleOfferAction} submitLabel={o.is_active ? "Pause" : "Activate"} buttonClass="btn btn-ghost h-8 px-3 text-xs">
                  <input type="hidden" name="offerId" value={String(o.offer_id)} />
                  <input type="hidden" name="active" value={o.is_active ? "0" : "1"} />
                </ActionForm>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
