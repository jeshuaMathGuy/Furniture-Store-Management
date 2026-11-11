import Link from "next/link";
import { can, requireSession } from "@/lib/server/auth";

/** Common frame for lab sub-pages: sign-in required, then the lab:read permission. */
export async function LabPage({ path, eyebrow, title, intro, children }: {
  path: string; eyebrow: string; title: string; intro: React.ReactNode; children: React.ReactNode;
}) {
  const session = await requireSession(path);
  return (
    <div className="mx-auto max-w-7xl px-4 pb-12 pt-10 sm:px-6 lg:px-10">
      <p className="eyebrow"><Link href="/lab" className="hover:underline">Database Lab</Link> · {eyebrow}</p>
      <h1 className="mt-3 text-4xl sm:text-5xl">{title}</h1>
      <div className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-soft">{intro}</div>
      <div className="mt-8">
        {can(session, "lab:read") ? children : (
          <p role="alert" className="rounded-xl bg-clay/12 px-4 py-3 text-sm text-clay-deep">The lab is available to student and administrator accounts.</p>
        )}
      </div>
    </div>
  );
}

export function LabPlaceholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-12 pt-10 sm:px-6">
      <p className="eyebrow"><Link href="/lab" className="hover:underline">Database Lab</Link></p>
      <h1 className="mt-3 text-4xl">{title}</h1>
      <p className="mt-3 text-sm text-ink-soft">{body} <Link href="/lab/sql" className="underline">Open the SQL playground</Link> or <Link href="/lab/procedures" className="underline">the scenario lab</Link>.</p>
    </div>
  );
}
