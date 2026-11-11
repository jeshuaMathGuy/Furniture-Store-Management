import type { Metadata } from "next";
import { LAB_QUERIES } from "@furni/database/src/lab/queries";
import { LabPage } from "@/components/lab/lab-page";
import { SqlPlayground } from "@/components/lab/sql-playground";

export const metadata: Metadata = { title: "SQL playground · Lab" };
export const dynamic = "force-dynamic";

export default function SqlLabPage() {
  return (
    <LabPage path="/lab/sql" eyebrow="Read-only sandbox" title="SQL playground"
      intro={<>Queries run as the MySQL account <code>lab_reader</code>, which can only SELECT from the lab sandbox (never the store&apos;s database). That privilege boundary is the security control. On top of it, a SQL parser accepts a single SELECT, WITH, EXPLAIN, SHOW or DESCRIBE, and every query runs in <code>START TRANSACTION READ ONLY</code> with a 3-second <code>MAX_EXECUTION_TIME</code> and a 500-row cap.</>}>
      <SqlPlayground examples={LAB_QUERIES} />
    </LabPage>
  );
}