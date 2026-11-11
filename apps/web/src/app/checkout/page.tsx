import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commerce } from "@furni/database";
import { asOfDate, db } from "@/lib/server/db";
import { requireSession } from "@/lib/server/auth";
import { formatPrice } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { addAddressAction } from "../cart/actions";
import { CheckoutForm } from "./checkout-form";

export const metadata: Metadata = { title: "Checkout" };
export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const session = await requireSession("/checkout");
  if (!session.customerId) redirect("/cart");
  const [cart, addresses] = await Promise.all([commerce.getCart(db(), session, asOfDate()), commerce.listAddresses(db(), session)]);
  if (cart.lines.length === 0) redirect("/cart");

  return (
    <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:px-10">
      <p className="eyebrow">Checkout</p>
      <h1 className="mt-3 text-5xl">Deliver and pay</h1>
      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_340px]">
        <div className="space-y-10">
          <CheckoutForm addresses={addresses} total={formatPrice(cart.subtotal)} />
          <details className="rounded-2xl border hairline p-5">
            <summary className="cursor-pointer text-sm font-medium">Add a delivery address</summary>
            <ActionForm action={addAddressAction} submitLabel="Save address" className="mt-4 grid gap-3 sm:grid-cols-2" testId="address-form">
              <label className="sm:col-span-2"><span className="mb-1 block text-sm">Address line</span><input className="field" name="line1" required minLength={3} /></label>
              <label className="sm:col-span-2"><span className="mb-1 block text-sm">Apartment, landmark (optional)</span><input className="field" name="line2" /></label>
              <label><span className="mb-1 block text-sm">PIN code</span><input className="field" name="postalCode" inputMode="numeric" pattern="\d{6}" required /></label>
              <label><span className="mb-1 block text-sm">City</span><input className="field" name="city" required /></label>
              <label className="sm:col-span-2"><span className="mb-1 block text-sm">State</span><input className="field" name="region" required /></label>
            </ActionForm>
          </details>
        </div>
        <aside className="h-fit rounded-3xl border hairline bg-white/50 p-6">
          <p className="eyebrow">Summary</p>
          <ul className="mt-4 space-y-3 text-sm">
            {cart.lines.map((l) => (
              <li key={l.productId} className="flex justify-between gap-3">
                <span>{l.quantity} × {l.name}{l.variantName ? <span className="text-ink-soft"> · {l.variantName}</span> : null}</span>
                <span>{formatPrice(l.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 flex justify-between border-t hairline pt-3"><span>Total</span><span className="font-display text-2xl">{formatPrice(cart.subtotal)}</span></p>
        </aside>
      </div>
    </div>
  );
}
