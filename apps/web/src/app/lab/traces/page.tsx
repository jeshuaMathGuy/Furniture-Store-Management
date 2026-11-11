import type { Metadata } from "next";
import { ScenarioPage } from "@/components/lab/scenario-page";

export const metadata: Metadata = { title: "Execution traces · Lab" };
export const dynamic = "force-dynamic";

export default function TracesPage() {
  return <ScenarioPage path="/lab/traces" eyebrow="Replay" title="Execution traces"
    intro="Every server-defined scenario (procedures, triggers, functions, transactions, concurrency). Each run produces a trace from observed MySQL state: before/after snapshots, statements, trigger effects and the outcome, re-validated against the database. Step through it with Previous and Next." />;
}