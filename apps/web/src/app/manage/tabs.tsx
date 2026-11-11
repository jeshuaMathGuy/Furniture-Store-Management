"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ManageTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Management sections" className="mt-4 flex gap-1 overflow-x-auto border-b hairline">
      {tabs.map((t) => {
        const active = t.href === "/manage" ? path === "/manage" : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors ${active ? "border-charcoal text-charcoal" : "border-transparent text-ink-soft hover:text-charcoal"}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
