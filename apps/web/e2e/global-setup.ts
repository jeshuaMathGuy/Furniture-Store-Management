import { loadConfig } from "../../../packages/database/src/config.js";
import { setupAll } from "../../../packages/database/src/setup.js";
import { e2eDbNames } from "./db-names";

/**
 * Build a fresh, isolated set of schemas for this e2e run (E2E_DB_PREFIX),
 * so end-to-end tests never mutate the developer's furni_form_app and parallel runs never collide.
 */
export default async function globalSetup() {
  const n = e2eDbNames();
  await setupAll(loadConfig({ APP_DB_NAME: n.app, LAB_DB_NAME: n.lab, TEACHING_DB_NAME: n.teaching }), { reset: true, writeArtifacts: false });
}
