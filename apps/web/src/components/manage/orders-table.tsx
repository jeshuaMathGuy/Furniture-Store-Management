import Link from "next/link";
import { formatPrice, titleCase } from "@/lib/format";

export function OrdersTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return <p className="mt-4 text-sm text-ink-soft">No orders.</p>;
  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border hairline">
      <table className="w-full min-w-[640px] text-left text-sm" data-testid="manage-orders">
        <thead className="bg-limestone/70 text-xs uppercase tracking-wider text-ink-soft">
          <tr>{["Order", "Customer", "Date", "Lines", "Status", "Total"].map((h) => <th key={h} scope="col" className="px-4 py-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={String(o.order_id)} className="border-t hairline">
              <td className="px-4 py-3 font-mono"><Link href={`/orders/${String(o.order_id)}`} className="underline underline-offset-4">#{String(o.order_id)}</Link></td>
              <td className="px-4 py-3">{String(o.customer_name)}</td>
              <td className="px-4 py-3">{String(o.order_date).slice(0, 16)}</td>
              <td className="px-4 py-3">{String(o.line_count)}</td>
              <td className="px-4 py-3">{titleCase(String(o.order_status))}</td>
              <td className="px-4 py-3 text-right font-display">{formatPrice(String(o.order_total))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
