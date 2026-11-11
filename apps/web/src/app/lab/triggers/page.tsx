import type { Metadata } from "next";
import { ScenarioPage } from "@/components/lab/scenario-page";

export const metadata: Metadata = { title: "Triggers · Lab" };
export const dynamic = "force-dynamic";

export default function TriggersPage() {
  return <ScenarioPage category="trigger" path="/lab/triggers" eyebrow="BEFORE / AFTER" title="Triggers"
    intro="The order state machine enforced by bu_sales_order, the history and audit rows written by au_sales_order and au_product, and the insert guards bi_sales_order and bi_order_line. Rejected statements show MySQL's own error." />;
}