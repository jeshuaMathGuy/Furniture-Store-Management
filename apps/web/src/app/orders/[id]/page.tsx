import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { commerce, DomainError } from "@furni/database";
import { db } from "@/lib/server/db";
import { can, requireSession } from "@/lib/server/auth";
import { ActionForm } from "@/components/action-form";
import { FurnitureGlyph } from "@/components/furniture-glyph";
import { formatDate, formatPrice, titleCase } from "@/lib/format";
import { cancelOrderAction, confirmOrderAction, deliverOrderAction, shipOrderAction } from "../actions";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ placed?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Order #${(await params).id}` };
}

const FLOW = ["placed", "confirmed", "shipped", "delivered"] as const;

export default async function OrderPage({ params, searchParams }: Props) {
  const { id } = await params;
  const session = await requireSession(`/orders/${id}`);
  if (!/^\d{1,9}$/.test(id)) notFound();
  let o: Awaited<ReturnType<typeof commerce.getOrderDetail>>;
  try { o = await commerce.getOrderDetail(db(), session, Number(id)); }
  catch (e) { if (e instanceof DomainError) notFound(); throw e; }
  const justPlaced = (await searchParams).placed === "1";
  const staff = can(session, "order:any:read");
  const reached = o.status === "cancelled" ? -1 : FLOW.indexOf(o.status as (typeof FLOW)[number]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:px-10" data-testid="order-page" data-status={o.status}>
      {justPlaced && (
        <div role="status" className="mb-8 rounded-2xl border border-sage/60 bg-sage/15 p-5" data-testid="order-placed">
          <p className="font-display text-2xl">Thank you. Your order is placed.</p>
          <p className="mt-1 text-sm text-ink-soft">Stock is reserved when the warehouse confirms it. Your simulated payment is authorised, not captured.</p>
        </div>
      )}
      <p className="eyebrow">{staff ? <Link href="/manage/orders" className="hover:underline">Orders</Link> : <Link href="/account" className="hover:underline">Account</Link>} / order</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-5xl">Order #{o.orderId}</h1>
        <p className="font-display text-3xl">{formatPrice(o.orderTotal)}</p>
      </div>
      <p className="mt-2 text-sm text-ink-soft">{o.customerName} · placed {formatDate(o.orderDate)} · status <strong data-testid="order-status">{titleCase(o.status)}</strong></p>

      {/* Status flow: the transitions bu_sales_order allows */}
      <ol className="mt-8 grid grid-cols-4 gap-2" aria-label="Order progress">
        {FLOW.map((s, i) => (
          <li key={s} className={`rounded-xl border px-3 py-2 text-center text-xs ${o.status === "cancelled" ? "hairline text-ink-soft line-through" : i <= reached ? "border-charcoal bg-charcoal text-porcelain" : "hairline text-ink-soft"}`}
            aria-current={FLOW[reached] === s ? "step" : undefined}>{titleCase(s)}</li>
        ))}
      </ol>
      {o.cancellation && (
        <p className="mt-3 text-sm text-clay-deep">
          Cancelled from {String(o.cancellation.previous_status)}: “{String(o.cancellation.reason)}”{o.cancellation.stock_restored ? " (stock returned)" : ""}
        </p>
      )}

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_300px]">
        <section aria-labelledby="lines">
          <h2 id="lines" className="text-2xl">Pieces</h2>
          <ul className="mt-4 divide-y hairline border-y hairline">
            {o.lines.map((l) => {
              const cfg = (l.configuration ?? {}) as { variant?: string; colorHex?: string; offer?: string };
              return (
                <li key={String(l.product_id)} className="flex gap-4 py-4">
                  <FurnitureGlyph modelKey={l.model_key as string | null} material={l.primary_material as string | null} color={cfg.colorHex} label={String(l.product_name)} className="h-16 w-20 shrink-0 rounded-lg bg-limestone p-2" />
                  <div className="flex-1 text-sm">
                    <p className="font-display text-lg">{String(l.product_name)}</p>
                    <p className="text-ink-soft">{l.quantity as number} × {formatPrice(String(l.unit_price))}{Number(l.discount_pct) > 0 ? ` −${Number(l.discount_pct)}%${cfg.offer ? ` (${cfg.offer})` : ""}` : ""}{cfg.variant ? ` · ${cfg.variant}` : ""} · {String(l.supplier_name)}</p>
                  </div>
                  <p className="font-display">{formatPrice(String(l.line_total))}</p>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-ink-soft">Line totals come from order_line.line_total, a generated column: ROUND(quantity × unit_price × (1 − discount_pct/100), 2).</p>

          <h2 className="mt-10 text-2xl">History</h2>
          <p className="mt-1 text-xs text-ink-soft">Written by the original trigger au_sales_order on every status change.</p>
          <ol className="mt-4 space-y-2 border-l hairline pl-4 text-sm" data-testid="order-history">
            {o.history.map((h) => (
              <li key={String(h.history_id)}><span className="font-medium">{titleCase(String(h.order_status))}</span> <span className="text-ink-soft">· {String(h.changed_at)} · {String(h.remarks ?? "")}</span></li>
            ))}
          </ol>
          {o.audit.length > 0 && (
            <details className="mt-6 text-sm">
              <summary className="cursor-pointer text-ink-soft">Audit log ({o.audit.length})</summary>
              <ul className="mt-2 space-y-1 font-mono text-xs">
                {o.audit.map((a) => <li key={String(a.audit_id)}>#{String(a.audit_id)} {String(a.old_value)} → {String(a.new_value)} · {String(a.event_time)}</li>)}
              </ul>
            </details>
          )}
        </section>

        <aside className="space-y-6 text-sm">
          {o.shipment && (
            <div className="rounded-2xl border hairline p-4">
              <p className="eyebrow">Delivery</p>
              <p className="mt-2">{String(o.shipment.line1)}{o.shipment.line2 ? `, ${String(o.shipment.line2)}` : ""}<br />{String(o.shipment.city)}, {String(o.shipment.region)} {String(o.shipment.postal_code)}</p>
              <p className="mt-2 text-ink-soft">{String(o.shipment.carrier)}{o.shipment.tracking_ref ? ` · ${String(o.shipment.tracking_ref)}` : ""}{o.shipment.delivered_at ? ` · delivered ${String(o.shipment.delivered_at)}` : o.shipment.shipped_at ? ` · shipped ${String(o.shipment.shipped_at)}` : ""}</p>
            </div>
          )}
          {o.payments.map((p, i) => (
            <div key={i} className="rounded-2xl border hairline p-4" data-testid="order-payment">
              <p className="eyebrow">Payment · simulated</p>
              <p className="mt-2">{formatPrice(String(p.amount))} · <strong>{titleCase(String(p.payment_status))}</strong></p>
              <p className="font-mono text-xs text-ink-soft">{String(p.provider_ref)}</p>
            </div>
          ))}
          {o.plans.length > 0 && (
            <div className="rounded-2xl border hairline p-4">
              <p className="eyebrow">Warranty</p>
              <ul className="mt-2 space-y-1">
                {o.plans.map((p) => <li key={String(p.plan_code)}>{String(p.supplier_name)}: {String(p.warranty_months)} months, until {String(p.expires_on)}</li>)}
              </ul>
              <p className="mt-1 text-xs text-ink-soft">Expiry from fn_warranty_expiry.</p>
            </div>
          )}

          {o.canCustomerCancel && (
            <ActionForm action={cancelOrderAction} submitLabel="Cancel order" buttonClass="btn btn-ghost h-10" confirm="Cancel this order?" testId="customer-cancel">
              <input type="hidden" name="orderId" value={o.orderId} />
              <input type="hidden" name="reason" value="Cancelled by customer" />
            </ActionForm>
          )}

          {staff && (
            <div className="space-y-4 rounded-2xl border border-charcoal/20 bg-white/50 p-4" data-testid="staff-actions">
              <p className="eyebrow">Staff actions</p>
              {/* All forms stay mounted (disabled when not applicable) so each one's result and observed-effects panel survives the re-render. */}
              {can(session, "order:confirm") && (
                <ActionForm action={confirmOrderAction} submitLabel="Confirm (sp_confirm_order)" testId="confirm-form" disabled={o.status !== "placed"}>
                  <input type="hidden" name="orderId" value={o.orderId} />
                </ActionForm>
              )}
              {can(session, "order:fulfil") && (
                <ActionForm action={shipOrderAction} submitLabel="Mark shipped" className="space-y-2" testId="ship-form" disabled={o.status !== "confirmed"}>
                  <input type="hidden" name="orderId" value={o.orderId} />
                  <input className="field" name="carrier" placeholder="Carrier" defaultValue="FURNI Logistics" required aria-label="Carrier" />
                  <input className="field" name="trackingRef" placeholder="Tracking reference (optional)" aria-label="Tracking reference" />
                </ActionForm>
              )}
              {can(session, "order:fulfil") && (
                <ActionForm action={deliverOrderAction} submitLabel="Mark delivered" testId="deliver-form" disabled={o.status !== "shipped"}>
                  <input type="hidden" name="orderId" value={o.orderId} />
                </ActionForm>
              )}
              {can(session, "order:any:transition") && (
                <ActionForm action={cancelOrderAction} submitLabel="Cancel order" buttonClass="btn btn-ghost h-10" className="space-y-2" confirm="Cancel this order?" testId="staff-cancel"
                  disabled={!["draft", "placed", "confirmed"].includes(o.status)}>
                  <input type="hidden" name="orderId" value={o.orderId} />
                  <input className="field" name="reason" placeholder="Reason" defaultValue="Cancelled by the studio" required aria-label="Cancellation reason" />
                </ActionForm>
              )}
              {["delivered", "cancelled"].includes(o.status) && <p className="text-ink-soft">No further transitions are allowed by the trigger.</p>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
