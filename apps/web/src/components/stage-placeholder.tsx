import Link from "next/link";

/** Honest placeholder for an experience scheduled in a later build stage. */
export function StagePlaceholder({ eyebrow, title, body, stage, items, links }: {
  eyebrow: string; title: string; body: string; stage: number; items: string[];
  links?: { href: string; label: string }[];
}) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6 lg:px-10">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="mt-4 text-5xl leading-tight sm:text-6xl">{title}</h1>
      <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-soft">{body}</p>
      <div className="mt-10 rounded-3xl border border-dashed hairline p-8">
        <p className="text-sm">
          <span className="rounded-full bg-oat/60 px-2.5 py-1 text-xs font-medium">Planned: Stage {stage}</span>
          <span className="ml-3 text-ink-soft">This experience isn&apos;t built yet. It will include:</span>
        </p>
        <ul className="mt-5 grid gap-2 text-sm sm:grid-cols-2">
          {items.map((i) => <li key={i} className="flex gap-2"><span className="text-clay-deep" aria-hidden>—</span>{i}</li>)}
        </ul>
      </div>
      {links && (
        <div className="mt-8 flex flex-wrap gap-3">
          {links.map((l) => <Link key={l.href} href={l.href} className="btn btn-ghost">{l.label}</Link>)}
        </div>
      )}
    </div>
  );
}
