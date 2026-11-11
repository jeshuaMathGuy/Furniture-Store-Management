import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { operations } from "@furni/database";
import { db } from "@/lib/server/db";
import { can, requireSession } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Audit log · Management" };

export default async function AuditPage() {
  const session = await requireSession("/manage/audit");
  if (!can(session, "report:read")) notFound();
  const rows = await operations.recentAudit(db(), session, 100);
  return (
    <div>
      <h1 className="text-4xl">Audit log</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-soft">Every row here was written by an original trigger: au_sales_order for status changes, au_product for price changes. The application never writes audit_log directly.</p>
      <div className="mt-6 overflow-x-auto rounded-2xl border hairline">
        <table className="w-full min-w-[640px] text-left font-mono text-xs" data-testid="audit-table">
          <thead className="bg-limestone/70 uppercase tracking-wider text-ink-soft">
            <tr>{["#", "Entity", "Key", "Event", "Old", "New", "Time (UTC)"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={String(a.audit_id)} className="border-t hairline">
                {[a.audit_id, a.entity_name, a.entity_key, a.event_type, a.old_value, a.new_value, a.event_time].map((v, i) => <td key={i} className="px-3 py-2">{String(v ?? "NULL")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
