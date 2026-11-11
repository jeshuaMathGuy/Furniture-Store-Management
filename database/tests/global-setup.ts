import { setupAll } from "../../packages/database/src/setup.js";
import { testCfg } from "./helpers.js";

/** Build the test application DB, teaching snapshots and lab sandbox from scratch once per run. */
export default async function () {
  await setupAll(testCfg(), { reset: true, writeArtifacts: false });
}
