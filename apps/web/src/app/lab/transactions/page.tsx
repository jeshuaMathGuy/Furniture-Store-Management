import type { Metadata } from "next";
import { ScenarioPage } from "@/components/lab/scenario-page";

export const metadata: Metadata = { title: "Transactions · Lab" };
export const dynamic = "force-dynamic";

export default function TransactionsPage() {
  return <ScenarioPage category="transaction" path="/lab/transactions" eyebrow="ACID" title="Transactions"
    intro="START TRANSACTION, SAVEPOINT, ROLLBACK TO SAVEPOINT, COMMIT, ROLLBACK and READ ONLY. Changes visible only inside an open transaction are marked as attempted, separately from what was persisted." />;
}