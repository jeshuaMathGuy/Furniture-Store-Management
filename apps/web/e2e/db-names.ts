export function e2eDbNames() {
  const p = process.env.E2E_DB_PREFIX ?? "furni_e2e";
  return { app: `${p}_app`, lab: `${p}_lab`, teaching: `${p}_teaching` };
}
