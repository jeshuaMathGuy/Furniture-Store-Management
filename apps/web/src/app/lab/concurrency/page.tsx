import type { Metadata } from "next";
import { ScenarioPage } from "@/components/lab/scenario-page";

export const metadata: Metadata = { title: "Concurrency · Lab" };
export const dynamic = "force-dynamic";

export default function ConcurrencyPage() {
  return <ScenarioPage category="concurrency" path="/lab/concurrency" eyebrow="Two sessions" title="Concurrency"
    intro="Real concurrent MySQL sessions: row-lock blocking, a bounded lock wait, a REPEATABLE READ snapshot and the F1 double-posting race with its named-lock mitigation." />;
}