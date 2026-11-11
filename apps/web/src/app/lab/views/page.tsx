import type { Metadata } from "next";
import { LabPlaceholder } from "@/components/lab/lab-page";

export const metadata: Metadata = { title: "Views · Lab" };

export default function ViewsPage() {
  return <LabPlaceholder title="Views" body="A dedicated views page is not built yet. The SQL playground has an example that reads the vw_* views." />;
}