"use client";

import Link from "next/link";
import { useActionState } from "react";
import { addToCartAction } from "@/app/cart/actions";
import type { ActionResult } from "@/lib/server/action";

export function AddToCart({ productId, variantId, available, variantLabel }: { productId: number; variantId: number | null; available: number; variantLabel?: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(addToCartAction, { ok: false });
  const max = Math.max(1, Math.min(20, available));
  return (
    <form action={action} className="flex flex-wrap items-center gap-3" data-testid="add-to-cart">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="variantId" value={variantId ?? ""} />
      <label className="flex items-center gap-2 text-sm">
        <span className="sr-only">Quantity</span>
        <select name="quantity" className="field h-11 w-20" defaultValue="1" disabled={available <= 0}>
          {Array.from({ length: max }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
        </select>
      </label>
      <button className="btn btn-primary" type="submit" disabled={pending || available <= 0}>
        {available <= 0 ? "Out of stock" : pending ? "Adding…" : `Add to cart${variantLabel ? ` · ${variantLabel}` : ""}`}
      </button>
      <div aria-live="polite" className="w-full text-sm">
        {state.ok && <p className="text-sage-deep" data-testid="cart-added">{state.message} <Link href="/cart" className="underline underline-offset-4">View cart</Link></p>}
        {state.error && (
          <p role="alert" className="text-clay-deep">
            {state.error}{" "}
            {state.error.startsWith("Sign in") && <Link href={`/login?next=${encodeURIComponent(typeof window === "undefined" ? "/" : location.pathname)}`} className="underline underline-offset-4">Sign in</Link>}
          </p>
        )}
      </div>
    </form>
  );
}
