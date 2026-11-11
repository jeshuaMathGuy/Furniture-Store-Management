import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { operations } from "@furni/database";
import { db } from "@/lib/server/db";
import { can, requireSession } from "@/lib/server/auth";
import { formatPrice, titleCase } from "@/lib/format";
import { OrdersTable } from "@/components/manage/orders-table";

export const metadata: Metadata = { title: "Management" };

const STATUSES = ["placed", "confirmed", "shipped", "delivered", "cancelled"];

export default async function ManageOverview() {
  const session = await requireSession("/manage");
  if (!can(session, "order:any:read")) redirect("/manage/supplier");
  const [d, recent] = await Promise.all([operations.dashboard(db(), session), operations.listOrders(db(), session)]);
  const tile = (label: string, value: React.ReactNode, href?: string, testId?: string) => (
    <div className="rounded-2xl border hairline bg-white/50 p-5" data-testid={testId}>
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-display text-3xl">{href ? <Link href={href} className="hover:underline">{value}</Link> : value}</p>
    </div>
  );
  return (
    <div className="space-y-10">
      <h1 className="text-4xl">Run the studio.</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tile("Awaiting confirmation", d.ordersByStatus.placed ?? 0, "/manage/orders?status=placed", "tile-placed")}
        {tile("Low stock", d.lowStock, "/manage/inventory")}
        {tile("Pending receipts", d.pendingReceipts, "/manage/inventory")}
        {tile("Delivered revenue", formatPrice(d.deliveredRevenue))}
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        {STATUSES.map((s) => (
          <Link key={s} href={`/manage/orders?status=${s}`} className="rounded-full bg-limestone px-3 py-1.5 hover:bg-oat/60">{titleCase(s)} · {d.ordersByStatus[s] ?? 0}</Link>
        ))}
      </div>
      <section>
        <h2 className="text-2xl">Recent orders</h2>
        <OrdersTable rows={recent.slice(0, 8)} />
      </section>
    </div>
  );
}
