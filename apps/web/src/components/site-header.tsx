import Link from "next/link";
import { commerce } from "@furni/database";
import { getSession, can } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { signOut } from "@/app/login/actions";
import { NavLinks, type NavItem } from "./nav-links";

export async function SiteHeader() {
  const session = await getSession();
  const cartItems = session?.customerId ? await commerce.cartCount(db(), session) : 0;
  const items: NavItem[] = [
    { href: "/", label: "Discover" },
    { href: "/collection", label: "Collection" },
    { href: "/showroom", label: "Showroom" },
    { href: "/studio", label: "Studio" },
    { href: "/lab", label: "Database Lab" },
  ];
  if (can(session, "order:any:read") || can(session, "supplier:own:read")) items.push({ href: "/manage", label: "Management" });

  return (
    <header className="sticky top-0 z-40 border-b hairline bg-porcelain/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-10">
        <Link href="/" className="font-display text-xl tracking-tight text-charcoal" aria-label="FURNI / FORM home">
          FURNI <span className="text-clay-deep">/</span> FORM
        </Link>
        <NavLinks items={items} />
        <div className="ml-auto flex items-center gap-3">
          {session?.customerId && (
            <Link href="/cart" className="relative text-sm text-ink-soft hover:text-charcoal" data-testid="cart-link" aria-label={`Cart, ${cartItems} item${cartItems === 1 ? "" : "s"}`}>
              Cart
              {cartItems > 0 && <span className="ml-1 rounded-full bg-clay-deep px-1.5 py-0.5 text-[10px] text-porcelain" data-testid="cart-count">{cartItems}</span>}
            </Link>
          )}
          {session ? (
            <>
              <Link href="/account" className="hidden text-sm text-ink-soft hover:text-charcoal sm:inline" data-testid="account-link">
                {session.displayName}
              </Link>
              <form action={signOut}>
                <button className="btn btn-ghost h-9 px-4 text-xs" type="submit">Sign out</button>
              </form>
            </>
          ) : (
            <Link href="/login" className="btn btn-ghost h-9 px-4 text-xs">Sign in</Link>
          )}
        </div>
      </div>
    </header>
  );
}
