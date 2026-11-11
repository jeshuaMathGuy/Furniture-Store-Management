import Link from "next/link";
import { RenderModeControl } from "./render-mode";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t hairline">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-10">
        <div>
          <p className="font-display text-2xl">FURNI <span className="text-clay-deep">/</span> FORM</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-soft">
            Architecture in appearance. Relational integrity underneath.
          </p>
        </div>
        <div className="text-sm">
          <p className="eyebrow mb-3">Studio</p>
          <ul className="space-y-2 text-ink-soft">
            <li><Link className="hover:text-charcoal" href="/collection">Collection</Link></li>
            <li><Link className="hover:text-charcoal" href="/showroom">Showroom</Link></li>
            <li><Link className="hover:text-charcoal" href="/studio">Studio</Link></li>
          </ul>
        </div>
        <div className="text-sm">
          <p className="eyebrow mb-3">Laboratory</p>
          <ul className="space-y-2 text-ink-soft">
            <li><Link className="hover:text-charcoal" href="/lab">Database Lab</Link></li>
            <li><Link className="hover:text-charcoal" href="/account">Account</Link></li>
          </ul>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-10"><RenderModeControl /></div>
      <p className="mx-auto max-w-7xl px-4 pb-10 text-xs text-ink-soft sm:px-6 lg:px-10">
        College demonstration project. Supplier names in the expanded catalogue are fictional, and prices are illustrative.
      </p>
    </footer>
  );
}
