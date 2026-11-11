import "server-only";
import { createLabPool, loadLabConfig, type LabDbConfig, type Pool } from "@furni/database";

const g = globalThis as unknown as { __furniLabReader?: Pool; __furniLabOperator?: Pool; __furniTeaching?: Pool };

export function labConfig(): LabDbConfig { return loadLabConfig(); }

/** SELECT-only access to the disposable lab sandbox (also has SELECT on the teaching schema). */
export function labReader(): Pool {
  g.__furniLabReader ??= createLabPool(loadLabConfig(), "lab_reader");
  return g.__furniLabReader;
}

/** Read-only access to the immutable normalization snapshots (furniture_teaching). */
export function teachingReader(): Pool {
  const cfg = loadLabConfig();
  g.__furniTeaching ??= createLabPool(cfg, "lab_reader", cfg.TEACHING_DB_NAME);
  return g.__furniTeaching;
}

/** Scenario user: DML + EXECUTE on the lab schema only. Use only for server-defined scenarios, never for user SQL. */
export function labOperator(): Pool {
  g.__furniLabOperator ??= createLabPool(loadLabConfig(), "lab_operator");
  return g.__furniLabOperator;
}
