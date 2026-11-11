import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { operations } from "@furni/database";
import { db } from "@/lib/server/db";
import { can, requireSession } from "@/lib/server/auth";
import { ActionForm } from "@/components/action-form";
import { formatPrice } from "@/lib/format";
import { awardLoyaltyAction, buildSettlementsAction } from "../actions";

export const metadata: Metadata = { title: "Settlements & loyalty · Management" };

export default async function FinancePage() {
  const session = await requireSession("/manage/finance");
  if (!can(session, "settlement:manage")) notFound();
  const [settlements, loyalty] = await Promise.all([operations.listSettlements(db(), session), operations.loyaltyOverview(db(), session)]);
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";
  return (
    <div className="grid gap-14 lg:grid-cols-2">
      <section>
        <h1 className="text-4xl">Supplier settlements</h1>
        <p className="mt-2 text-sm text-ink-soft">sp_build_supplier_settlements sums the line totals of delivered orders per supplier for the period (grouped by order date, audit F15) and upserts one row per supplier and period.</p>
        <ActionForm action={buildSettlementsAction} submitLabel="Build settlements" className="mt-4 flex flex-wrap items-end gap-2" testId="settlement-form">
          <label className="text-xs">From<input type="date" name="periodStart" className="field mt-1" defaultValue={monthStart} required /></label>
          <label className="text-xs">To<input type="date" name="periodEnd" className="field mt-1" defaultValue={today} required /></label>
        </ActionForm>
        <ul className="mt-6 space-y-2 text-sm" data-testid="settlements">
          {settlements.map((s) => (
            <li key={String(s.settlement_id)} className="flex justify-between rounded-xl border hairline px-4 py-3">
              <span>{String(s.supplier_name)} · {String(s.period_start)} to {String(s.period_end)}</span>
              <span className="font-display">{formatPrice(String(s.settlement_amount))}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="text-4xl">Loyalty</h2>
        <p className="mt-2 text-sm text-ink-soft">sp_award_loyalty awards FLOOR(total / 100) points per delivered order up to the cutoff date, once per order (loyalty_award&apos;s primary key prevents duplicates).</p>
        <ActionForm action={awardLoyaltyAction} submitLabel="Award points" className="mt-4 flex flex-wrap items-end gap-2" testId="loyalty-form">
          <label className="text-xs">Cutoff<input type="date" name="cutoff" className="field mt-1" defaultValue={today} required /></label>
        </ActionForm>
        <table className="mt-6 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-ink-soft"><tr><th className="py-2">Customer</th><th>Delivered orders</th><th className="text-right">Points</th></tr></thead>
          <tbody>
            {loyalty.map((l) => (
              <tr key={String(l.customer_id)} className="border-t hairline"><td className="py-2">{String(l.customer_name)}</td><td>{String(l.delivered_orders)}</td><td className="text-right font-mono">{String(l.loyalty_points)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
