"use server";

import { revalidatePath } from "next/cache";
import { commerce, operations, orders } from "@furni/database";
import { db } from "@/lib/server/db";
import { getSession } from "@/lib/server/auth";
import { field, num, runAction, type ActionResult } from "@/lib/server/action";

function refresh(orderId: number) {
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/manage", "layout");
  revalidatePath("/account");
}

export async function cancelOrderAction(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await getSession();
  const id = num(form, "orderId");
  const r = await runAction(async () => {
    const res = await commerce.cancelOrder(db(), session, id, field(form, "reason") || "Cancelled by request");
    return res.stockRestored ? "Order cancelled. The stock deducted at confirmation was returned." : "Order cancelled.";
  }, { observe: true });
  refresh(id);
  return r;
}

/** Calls the original sp_confirm_order: stock checks, deduction and rollback happen in the database. */
export async function confirmOrderAction(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await getSession();
  const id = num(form, "orderId");
  const r = await runAction(async () => { await orders.confirmOrder(db(), session, id); return "Confirmed by sp_confirm_order; stock deducted."; }, { observe: true });
  refresh(id);
  return r;
}

export async function shipOrderAction(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await getSession();
  const id = num(form, "orderId");
  const r = await runAction(async () => { await operations.shipOrder(db(), session, id, field(form, "carrier"), field(form, "trackingRef")); return "Marked as shipped."; }, { observe: true });
  refresh(id);
  return r;
}

export async function deliverOrderAction(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await getSession();
  const id = num(form, "orderId");
  const r = await runAction(async () => { await operations.deliverOrder(db(), session, id); return "Marked as delivered; payment captured."; }, { observe: true });
  refresh(id);
  return r;
}

export async function reviewAction(_p: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await getSession();
  const r = await runAction(async () => {
    await commerce.addReview(db(), session, { productId: num(form, "productId"), rating: num(form, "rating"), comment: field(form, "comment") });
    return "Thank you. Your review is published.";
  });
  revalidatePath("/account");
  revalidatePath(`/collection/${num(form, "productId")}`);
  return r;
}
