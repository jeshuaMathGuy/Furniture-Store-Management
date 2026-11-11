import { scenarioCatalog } from "@furni/database/src/lab/scenarios";
import type { ScenarioCategory } from "@furni/database/src/lab/trace";
import { can, getSession } from "@/lib/server/auth";
import { LabPage } from "./lab-page";
import { ScenarioLab } from "./scenario-lab";

export async function ScenarioPage({ category, path, eyebrow, title, intro }: {
  category?: ScenarioCategory; path: string; eyebrow: string; title: string; intro: React.ReactNode;
}) {
  const session = await getSession();
  return (
    <LabPage path={path} eyebrow={eyebrow} title={title} intro={intro}>
      <ScenarioLab scenarios={scenarioCatalog(category)} canRun={can(session, "lab:scenario:run")} />
    </LabPage>
  );
}
