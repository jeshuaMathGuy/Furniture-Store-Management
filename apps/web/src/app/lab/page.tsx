import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Database Lab" };

const SECTIONS: { href: string; eyebrow: string; title: string; body: string }[] = [
  { href: "/lab/normalization", eyebrow: "UNF → 4NF", title: "Normalization", body: "Step through every decomposition in the source SQL, with dependencies, proofs and reconstruction checks." },
  { href: "/lab/sql", eyebrow: "Read-only sandbox", title: "SQL playground", body: "Run queries against an isolated copy of the database, with guided examples and execution plans." },
  { href: "/lab/schema", eyebrow: "Relations", title: "Schema explorer", body: "An interactive ER diagram of every table, key, trigger and view." },
  { href: "/lab/procedures", eyebrow: "Stored programs", title: "Procedures", body: "Run the five original procedures on the sandbox and watch their effects." },
  { href: "/lab/triggers", eyebrow: "BEFORE / AFTER", title: "Triggers", body: "The order state machine, history and audit rows, and rejected transitions." },
  { href: "/lab/functions", eyebrow: "Deterministic", title: "Functions", body: "fn_discounted_price and fn_warranty_expiry with live inputs." },
  { href: "/lab/views", eyebrow: "Virtual relations", title: "Views", body: "The five reporting views, their definitions and their results." },
  { href: "/lab/transactions", eyebrow: "ACID", title: "Transactions", body: "Savepoints, rollback and committed versus pending state." },
  { href: "/lab/concurrency", eyebrow: "Two sessions", title: "Concurrency", body: "Row locks, blocking and the double-posting race found in the source (F1)." },
  { href: "/lab/traces", eyebrow: "Replay", title: "Execution traces", body: "Replay recorded executions: table diffs, timeline, graph and dashboard in sync." },
];

export default function Lab() {
  return (
    <div className="mx-auto max-w-7xl px-4 pb-10 pt-12 sm:px-6 lg:px-10">
      <header className="rise max-w-3xl">
        <p className="eyebrow">Database Lab</p>
        <h1 className="mt-3 text-5xl leading-[1.05] sm:text-6xl">Take the schema apart.</h1>
        <p className="mt-4 max-w-xl text-ink-soft">
          Everything here runs against an isolated sandbox rebuilt from the original SQL, or against immutable snapshots of each normalization stage.
          The store&apos;s own database is never touched.
        </p>
      </header>
      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="group block h-full rounded-3xl border hairline bg-white/40 p-6 transition-colors hover:bg-white/70" data-testid="lab-section">
              <p className="eyebrow">{s.eyebrow}</p>
              <p className="mt-2 font-display text-2xl group-hover:underline">{s.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{s.body}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
