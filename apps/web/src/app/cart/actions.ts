"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { commerce, DomainError } from "@furni/database";
import { db, asOfDate } from "@/lib/server/db";
import { getSession } from "@/lib/server/auth";
import { field, num, runAction, type ActionResult } from "@/lib/server/action";

export async function addToCartAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in as a customer to add pieces to your cart." };
  const variant = field(form, "variantId");
  const result = await runAction(async () => {
    await commerce.addToCart(db(), session, { productId: num(form, "productId"), variantId: variant ? Number(variant) : null, quantity: num(form, "quantity") || 1 });
    return "Added to your cart.";
  });
  revalidatePath("/", "layout");
  return result;
}

export async function setQuantityAction(form: FormData): Promise<void> {
  const session = await getSession();
  // "Remove" is its own field: the quantity <select> in the same form also submits "quantity".
  const qty = field(form, "remove") === "1" ? 0 : num(form, "quantity");
  await commerce.setCartQuantity(db(), session, num(form, "productId"), qty);
  revalidatePath("/", "layout");
}

export async function addAddressAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await getSession();
  const values = Object.fromEntries(["line1", "line2", "postalCode", "city", "region"].map((k) => [k, field(form, k)]));
  const result = await runAction(async () => {
    await commerce.addAddress(db(), session, values as { line1: string; postalCode: string; city: string; region: string; line2?: string });
    return "Address saved.";
  }, { values });
  revalidatePath("/checkout");
  return result;
}

export async function placeOrderAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await getSession();
  let orderId: number;
  try {
    const placed = await commerce.placeOrder(db(), session, {
      addressId: num(form, "addressId"),
      paymentOutcome: field(form, "paymentOutcome") === "decline" ? "decline" : "approve",
      asOf: asOfDate(),
    });
    orderId = placed.orderId;
  } catch (e) {
    if (e instanceof DomainError || (e instanceof Error && e.name === "ForbiddenError")) return { ok: false, error: e.message };
    if (e instanceof Error && e.name === "ZodError") return { ok: false, error: "Choose a delivery address." };
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(`/orders/${orderId}?placed=1`);
}
