"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export interface NavItem { href: string; label: string }

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

export function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  // Close the mobile menu after navigation.
  useEffect(() => { if (menu.current) menu.current.open = false; }, [path]);

  const link = (i: NavItem, mobile = false) => {
    const active = isActive(path, i.href);
    return (
      <Link
        key={i.href}
        href={i.href}
        aria-current={active ? "page" : undefined}
        className={
          mobile
            ? `block rounded-lg px-3 py-2.5 text-base ${active ? "bg-limestone text-charcoal" : "text-ink-soft"}`
            : `relative py-1 text-sm transition-colors after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:origin-left after:bg-charcoal after:transition-transform after:duration-300 ${
                active ? "text-charcoal after:scale-x-100" : "text-ink-soft hover:text-charcoal after:scale-x-0 hover:after:scale-x-100"
              }`
        }
      >
        {i.label}
      </Link>
    );
  };

  return (
    <>
      <nav aria-label="Primary" className="hidden items-center gap-6 lg:flex">{items.map((i) => link(i))}</nav>
      <details ref={menu} className="group relative lg:hidden">
        <summary className="btn btn-ghost h-9 cursor-pointer list-none px-4 text-xs [&::-webkit-details-marker]:hidden" aria-label="Open menu">
          Menu
        </summary>
        <nav aria-label="Primary" className="absolute left-0 top-12 w-60 rounded-2xl border hairline bg-porcelain p-2 shadow-lift">
          {items.map((i) => link(i, true))}
        </nav>
      </details>
    </>
  );
}
