import type { Metadata } from "next";
import { ScenarioPage } from "@/components/lab/scenario-page";

export const metadata: Metadata = { title: "Procedures · Lab" };
export const dynamic = "force-dynamic";

export default function ProceduresPage() {
  return <ScenarioPage category="procedure" path="/lab/procedures" eyebrow="Stored programs" title="Procedures"
    intro="The five original procedures, including their failure paths. Each one runs its own transaction (finding F3), so the trace snapshots the tables before and after the CALL and checks that a failed call left nothing behind." />;
}