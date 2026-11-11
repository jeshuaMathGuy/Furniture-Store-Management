import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { operations } from "@furni/database";
import { db } from "@/lib/server/db";
import { can, requireSession } from "@/lib/server/auth";
import { formatPrice, titleCase } from "@/lib/format";

export const metadata: Metadata = { title: "Supplier portal · Management" };

export default async function SupplierPortal() {
  const session = await requireSession("/manage/supplier");
  if (!can(session, "supplier:own:read") || session.supplierIds.length === 0) notFound();
  const views = await Promise.all(session.supplierIds.map((id) => operations.supplierOverview(db(), session, id)));
  return (
    <div className="space-y-16">
      {views.map((v) => (
        <section key={String(v.supplier.supplier_id)} data-testid="supplier-portal" aria-labelledby={`sup-${String(v.supplier.supplier_id)}`}>
          <h1 id={`sup-${String(v.supplier.supplier_id)}`} className="text-4xl">{String(v.supplier.supplier_name)}</h1>
          <p className="mt-2 text-sm text-ink-soft">
            Certifications: {v.certifications.join(", ") || "none"} · Regions: {v.regions.join(", ") || "none"} · Warranty plans: {v.plans.map((p) => `${String(p.plan_code)} (${String(p.warranty_months)} mo)`).join(", ") || "none"}
          </p>
          <p className="mt-1 text-xs text-ink-soft">Certifications and regions are the two independent multivalued facts that the 4NF decomposition split into separate tables.</p>

          <h2 className="mt-8 text-2xl">Your products</h2>
          <div className="mt-3 overflow-x-auto rounded-2xl border hairline">
            <table className="w-full min-w-[560px] text-left text-sm" data-testid="supplier-products">
              <thead className="bg-limestone/70 text-xs uppercase tracking-wider text-ink-soft"><tr>{["Product", "List price", "On hand", "Reorder point", "Units delivered"].map((h) => <th key={h} scope="col" className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {v.products.map((p) => (
                  <tr key={String(p.product_id)} className="border-t hairline">
                    <td className="px-4 py-2.5">{String(p.product_name)}</td><td className="px-4 py-2.5">{formatPrice(String(p.list_price))}</td>
                    <td className="px-4 py-2.5 font-mono">{String(p.qty_on_hand)}</td><td className="px-4 py-2.5 font-mono">{String(p.reorder_point ?? "—")}</td>
                    <td className="px-4 py-2.5 font-mono">{String(p.units_delivered)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-8 grid gap-8 md:grid-cols-2">
            <div>
              <h2 className="text-2xl">Receipts of your goods</h2>
              <ul className="mt-3 space-y-1 text-sm">
                {v.receipts.length === 0 ? <li className="text-ink-soft">None yet.</li> : v.receipts.map((r, i) => (
                  <li key={i}>#{String(r.receipt_id)} · {String(r.receipt_date)} · {String(r.quantity_received)} × {String(r.product_name)} · {titleCase(String(r.receipt_status))}</li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="text-2xl">Settlements</h2>
              <ul className="mt-3 space-y-1 text-sm" data-testid="supplier-settlements">
                {v.settlements.length === 0 ? <li className="text-ink-soft">No settlements yet.</li> : v.settlements.map((s, i) => (
                  <li key={i}>{String(s.period_start)} to {String(s.period_end)}: <strong>{formatPrice(String(s.settlement_amount))}</strong></li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
