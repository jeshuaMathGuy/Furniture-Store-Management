import type { Metadata } from "next";
import { operations } from "@furni/database";
import { db } from "@/lib/server/db";
import { can, requireSession } from "@/lib/server/auth";
import { ActionForm } from "@/components/action-form";
import { titleCase } from "@/lib/format";
import { advanceReorderAction, createReceiptAction, postReceiptAction, queueReordersAction } from "../actions";

export const metadata: Metadata = { title: "Inventory · Management" };

export default async function InventoryPage() {
  const session = await requireSession("/manage/inventory");
  const [stock, receipts, reorders] = await Promise.all([
    operations.inventoryList(db(), session), operations.listReceipts(db(), session), operations.listReorders(db(), session),
  ]);
  const receive = can(session, "inventory:receive"), reorder = can(session, "reorder:manage");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-14">
      <section>
        <h1 className="text-4xl">Inventory</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">Stock changes only through the original procedures: sp_confirm_order deducts, sp_receive_goods adds. &quot;Awaiting confirmation&quot; is demand from placed orders that has not been deducted yet.</p>
        <div className="mt-6 overflow-x-auto rounded-2xl border hairline">
          <table className="w-full min-w-[640px] text-left text-sm" data-testid="inventory-table">
            <thead className="bg-limestone/70 text-xs uppercase tracking-wider text-ink-soft">
              <tr>{["Product", "Supplier", "On hand", "Reorder point", "Reorder qty", "Awaiting confirmation"].map((h) => <th key={h} scope="col" className="px-4 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {stock.map((r) => (
                <tr key={String(r.product_id)} className="border-t hairline" data-product={String(r.product_id)}>
                  <td className="px-4 py-2.5">{String(r.product_name)} <span className="text-ink-soft">#{String(r.product_id)}</span></td>
                  <td className="px-4 py-2.5">{String(r.supplier_name)}</td>
                  <td className="px-4 py-2.5 font-mono" data-testid="qty-on-hand">{String(r.qty_on_hand)}{Number(r.low) ? <span className="ml-2 rounded-full bg-clay/15 px-2 py-0.5 text-[10px] text-clay-deep">LOW</span> : null}</td>
                  <td className="px-4 py-2.5 font-mono">{String(r.reorder_point)}</td>
                  <td className="px-4 py-2.5 font-mono">{String(r.reorder_qty)}</td>
                  <td className="px-4 py-2.5 font-mono">{String(r.awaiting_confirmation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-10 lg:grid-cols-2">
        <div>
          <h2 className="text-2xl">Goods receipts</h2>
          {receive && (
            <ActionForm action={createReceiptAction} submitLabel="Create pending receipt" className="mt-4 space-y-2 rounded-2xl border hairline p-4" testId="receipt-form">
              <label className="block text-sm">Receipt date <input type="date" name="receiptDate" className="field mt-1" defaultValue={today} required /></label>
              {[0, 1, 2].map((i) => (
                <div key={i} className="grid grid-cols-[1fr_110px] gap-2">
                  <select name={`product${i}`} className="field" defaultValue="" aria-label={`Product ${i + 1}`} required={i === 0}>
                    <option value="">{i === 0 ? "Choose a product" : "(optional) another product"}</option>
                    {stock.map((r) => <option key={String(r.product_id)} value={String(r.product_id)}>{String(r.product_name)}</option>)}
                  </select>
                  <input type="number" name={`qty${i}`} min={1} max={10000} placeholder="Qty" className="field" aria-label={`Quantity ${i + 1}`} required={i === 0} />
                </div>
              ))}
            </ActionForm>
          )}
          <ul className="mt-4 space-y-3" data-testid="receipts">
            {receipts.map((r) => (
              <li key={r.receiptId} className="rounded-2xl border hairline p-4 text-sm" data-receipt={r.receiptId} data-status={r.status}>
                <div className="flex items-center justify-between gap-3">
                  <p><span className="font-mono">#{r.receiptId}</span> · {r.date} · <strong>{titleCase(r.status)}</strong></p>
                  {receive && r.status === "pending" && (
                    <ActionForm action={postReceiptAction} submitLabel="Post receipt" buttonClass="btn btn-ghost h-9 px-3 text-xs" testId="post-receipt">
                      <input type="hidden" name="receiptId" value={r.receiptId} />
                    </ActionForm>
                  )}
                </div>
                <p className="mt-1 text-ink-soft">{r.lines.map((l) => `${l.qty} × ${l.name}`).join(", ") || "No lines"}</p>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-2xl">Reorder queue</h2>
          {reorder && (
            <ActionForm action={queueReordersAction} submitLabel="Run sp_queue_reorders" className="mt-4 flex flex-wrap items-end gap-2" testId="queue-form">
              <label className="text-sm">Request date <input type="date" name="requestDate" className="field mt-1" defaultValue={today} required /></label>
            </ActionForm>
          )}
          <ul className="mt-4 space-y-2" data-testid="reorders">
            {reorders.map((r) => (
              <li key={String(r.request_id)} className="flex items-center justify-between gap-3 rounded-xl border hairline px-4 py-3 text-sm">
                <span>{String(r.product_name)} · {String(r.requested_qty)} units · {String(r.request_date)} · <strong>{titleCase(String(r.request_status))}</strong></span>
                {reorder && r.request_status !== "closed" && (
                  <ActionForm action={advanceReorderAction} submitLabel={r.request_status === "open" ? "Mark ordered" : "Close"} buttonClass="btn btn-ghost h-8 px-3 text-xs">
                    <input type="hidden" name="requestId" value={String(r.request_id)} />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
