import type { Metadata } from "next";
import Link from "next/link";
import { operations } from "@furni/database";
import { db } from "@/lib/server/db";
import { requireSession } from "@/lib/server/auth";
import { titleCase } from "@/lib/format";
import { OrdersTable } from "@/components/manage/orders-table";

export const metadata: Metadata = { title: "Orders · Management" };

const FILTERS = ["", "placed", "confirmed", "shipped", "delivered", "cancelled"];

export default async function ManageOrders({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await requireSession("/manage/orders");
  const status = (await searchParams).status ?? "";
  const safe = FILTERS.includes(status) ? status : "";
  const rows = await operations.listOrders(db(), session, safe || undefined);
  return (
    <div>
      <h1 className="text-4xl">Orders</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-soft">Open an order to confirm it (sp_confirm_order deducts stock), ship, deliver or cancel it. The state machine is enforced by the original trigger bu_sales_order.</p>
      <nav aria-label="Filter by status" className="mt-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f || "all"} href={f ? `/manage/orders?status=${f}` : "/manage/orders"} aria-current={safe === f ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 text-sm ${safe === f ? "bg-charcoal text-porcelain" : "bg-limestone text-ink-soft hover:text-charcoal"}`}>{f ? titleCase(f) : "All"}</Link>
        ))}
      </nav>
      <OrdersTable rows={rows} />
    </div>
  );
}
