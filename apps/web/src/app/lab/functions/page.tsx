import type { Metadata } from "next";
import { ScenarioPage } from "@/components/lab/scenario-page";

export const metadata: Metadata = { title: "Functions · Lab" };
export const dynamic = "force-dynamic";

export default function FunctionsPage() {
  return <ScenarioPage category="function" path="/lab/functions" eyebrow="Deterministic" title="Functions"
    intro="fn_discounted_price and fn_warranty_expiry with valid, NULL and out-of-range inputs. Both are DETERMINISTIC NO SQL and return NULL for invalid input instead of raising an error." />;
}