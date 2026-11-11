import type { Metadata } from "next";
import Link from "next/link";
import { verifyAll, type NormalizationLabData } from "@furni/database/src/lab/normalization";
import { teachingReader } from "@/lib/server/lab-db";
import { NormalizationLab } from "@/components/lab/normalization/normalization-lab";

export const metadata: Metadata = { title: "Normalization Laboratory" };
export const dynamic = "force-dynamic";

/** Public and read-only: every row comes from the immutable teaching snapshot, read as lab_reader (SELECT only). */
export default async function NormalizationPage() {
  let data: NormalizationLabData | null = null;
  try {
    data = await verifyAll(teachingReader());
  } catch (err) {
    console.error("normalization lab: snapshot unavailable", err);
  }

  return (
    <div className="mx-auto max-w-[96rem] px-4 pb-6 pt-10 sm:px-6 lg:px-8">
      <header className="rise max-w-4xl">
        <p className="eyebrow"><Link href="/lab" className="hover:underline">Database Lab</Link> · UNF → 4NF</p>
        <h1 className="mt-3 text-4xl leading-[1.05] sm:text-5xl">Normalization, taken apart.</h1>
        <p className="mt-4 max-w-2xl text-ink-soft">
          Each stage is the exact decomposition performed by the original SQL script. Keys and proofs are computed from the declared dependencies;
          the row checks run live against the snapshot captured just before the script&apos;s operational demo.
        </p>
        {data && (
          <p className="mt-3 text-sm" data-testid="lab-summary">
            <span className="font-medium">{data.totals.checks}</span> live checks ·{" "}
            <span className="font-medium">{data.totals.violations}</span> violations ·{" "}
            {data.totals.sqlAgrees ? "SQL and in-memory results agree" : "SQL and in-memory results differ"}
          </p>
        )}
      </header>
      <div className="mt-8">
        {data ? <NormalizationLab data={data} /> : (
          <div role="alert" className="rounded-3xl border border-dashed hairline px-6 py-16 text-center">
            <p className="font-display text-2xl">The teaching snapshot is not available.</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
              Run <code className="font-mono">pnpm db:setup</code> to capture it, and check the lab reader settings in <code className="font-mono">apps/web/.env.local</code>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
