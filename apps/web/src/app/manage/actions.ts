"use server";

import { revalidatePath } from "next/cache";
import { inventory, operations } from "@furni/database";
import { db } from "@/lib/server/db";
import { getSession } from "@/lib/server/auth";
import { field, num, runAction, type ActionResult } from "@/lib/server/action";

const done = (r: ActionResult) => { revalidatePath("/manage", "layout"); return r; };

export async function createReceiptAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  const s = await getSession();
  const lines = [0, 1, 2].map((i) => ({ productId: num(f, `product${i}`), quantity: num(f, `qty${i}`) })).filter((l) => l.productId > 0 && l.quantity > 0);
  return done(await runAction(async () => `Receipt #${await operations.createReceipt(db(), s, { receiptDate: field(f, "receiptDate"), lines })} created (pending).`));
}

/** sp_receive_goods, serialised per receipt by the service's named lock (finding F1). */
export async function postReceiptAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  const s = await getSession();
  return done(await runAction(async () => { await inventory.receiveGoods(db(), s, num(f, "receiptId")); return "Posted by sp_receive_goods: stock increased."; }));
}

export async function queueReordersAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  const s = await getSession();
  return done(await runAction(async () => `sp_queue_reorders processed ${await inventory.queueReorders(db(), s, field(f, "requestDate"))} low-stock product(s).`));
}

export async function advanceReorderAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  const s = await getSession();
  return done(await runAction(async () => `Request is now ${await operations.advanceReorder(db(), s, num(f, "requestId"))}.`));
}

/** au_product audits the change; the panel shows the audit_log row it wrote. */
export async function setPriceAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  const s = await getSession();
  return done(await runAction(async () => { await operations.setListPrice(db(), s, num(f, "productId"), field(f, "price")); return "Price updated."; }, { observe: true }));
}

export async function toggleProductAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  const s = await getSession();
  const active = field(f, "active") === "1";
  return done(await runAction(async () => { await operations.setProductActive(db(), s, num(f, "productId"), active); return active ? "Product activated." : "Product hidden from the catalogue."; }));
}

export async function createOfferAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  const s = await getSession();
  return done(await runAction(async () => `Offer #${await operations.createOffer(db(), s, {
    productId: num(f, "productId"), offerName: field(f, "offerName"), discountPct: num(f, "discountPct"), startDate: field(f, "startDate"), endDate: field(f, "endDate"),
  })} created.`));
}

export async function toggleOfferAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  const s = await getSession();
  const active = field(f, "active") === "1";
  return done(await runAction(async () => { await operations.setOfferActive(db(), s, num(f, "offerId"), active); return active ? "Offer activated." : "Offer paused."; }));
}

export async function buildSettlementsAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  const s = await getSession();
  return done(await runAction(async () => `sp_build_supplier_settlements total: ₹${await operations.buildSettlements(db(), s, field(f, "periodStart"), field(f, "periodEnd"))}`));
}

export async function awardLoyaltyAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  const s = await getSession();
  return done(await runAction(async () => `sp_award_loyalty awarded ${await operations.awardLoyalty(db(), s, field(f, "cutoff"))} point(s).`));
}
