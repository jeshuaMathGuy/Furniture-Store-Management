"use client";

import { useActionState } from "react";
import { placeOrderAction } from "../cart/actions";
import type { ActionResult } from "@/lib/server/action";

interface Address { addressId: number; line1: string; line2: string | null; postalCode: string; city: string; region: string; isDefault: boolean }

export function CheckoutForm({ addresses, total }: { addresses: Address[]; total: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(placeOrderAction, { ok: false });
  return (
    <form action={action} className="space-y-10" data-testid="checkout-form">
      <fieldset>
        <legend className="eyebrow mb-3">Delivery address</legend>
        {addresses.length === 0 ? <p className="text-sm text-ink-soft">Add an address below.</p> : (
          <div className="space-y-2">
            {addresses.map((a, i) => (
              <label key={a.addressId} className="flex cursor-pointer gap-3 rounded-2xl border hairline p-4 has-[:checked]:border-charcoal has-[:checked]:bg-white/60">
                <input type="radio" name="addressId" value={a.addressId} defaultChecked={i === 0} required className="mt-1 accent-[#373a34]" />
                <span className="text-sm">{a.line1}{a.line2 ? `, ${a.line2}` : ""}<br /><span className="text-ink-soft">{a.city}, {a.region} {a.postalCode}</span></span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="eyebrow mb-3">Payment · simulated</legend>
        <div className="rounded-2xl border border-dashed hairline p-4 text-sm">
          <p>This is a local <strong>test-mode</strong> payment. No card or bank details are collected or stored. Choose the outcome to demonstrate:</p>
          <div className="mt-3 flex flex-wrap gap-4">
            <label className="flex items-center gap-2"><input type="radio" name="paymentOutcome" value="approve" defaultChecked className="accent-[#373a34]" /> Approve</label>
            <label className="flex items-center gap-2"><input type="radio" name="paymentOutcome" value="decline" className="accent-[#373a34]" /> Decline (whole checkout rolls back)</label>
          </div>
        </div>
      </fieldset>

      <div aria-live="polite">
        {state.error && <p role="alert" className="mb-4 rounded-lg bg-clay/12 px-3 py-2 text-sm text-clay-deep" data-testid="checkout-error">{state.error}</p>}
        <button className="btn btn-primary w-full sm:w-auto" type="submit" disabled={pending || addresses.length === 0}>
          {pending ? "Placing order…" : `Place order · ${total}`}
        </button>
      </div>
    </form>
  );
}
