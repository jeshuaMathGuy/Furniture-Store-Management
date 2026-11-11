import type { Metadata } from "next";
import { LabPlaceholder } from "@/components/lab/lab-page";

export const metadata: Metadata = { title: "Schema explorer · Lab" };

export default function SchemaPage() {
  return <LabPlaceholder title="Schema explorer" body="The interactive ER diagram is not built yet. The SQL playground's metadata example lists every key and constraint." />;
}