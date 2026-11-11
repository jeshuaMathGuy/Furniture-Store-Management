import { notFound } from "next/navigation";
import { can, requireSession } from "@/lib/server/auth";
import type { Permission } from "@furni/shared";
import { ManageTabs } from "./tabs";

export const dynamic = "force-dynamic";

const TABS: { href: string; label: string; perm: Permission }[] = [
  { href: "/manage", label: "Overview", perm: "order:any:read" },
  { href: "/manage/orders", label: "Orders", perm: "order:any:read" },
  { href: "/manage/inventory", label: "Inventory", perm: "inventory:read" },
  { href: "/manage/catalog", label: "Catalogue", perm: "product:manage" },
  { href: "/manage/finance", label: "Settlements & loyalty", perm: "settlement:manage" },
  { href: "/manage/audit", label: "Audit log", perm: "report:read" },
  { href: "/manage/supplier", label: "Supplier portal", perm: "supplier:own:read" },
];

export default async function ManageLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession("/manage");
  // Customers and students get a 404 rather than learning that the area exists.
  if (!can(session, "order:any:read") && !can(session, "supplier:own:read")) notFound();
  const tabs = TABS.filter((t) => can(session, t.perm)).map(({ href, label }) => ({ href, label }));
  return (
    <div className="mx-auto max-w-7xl px-4 pb-10 pt-10 sm:px-6 lg:px-10">
      <p className="eyebrow">Management · {session.roles.join(", ")}</p>
      <ManageTabs tabs={tabs} />
      <div className="mt-8">{children}</div>
    </div>
  );
}
