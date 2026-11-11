import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/** Load the repository's .env into process.env (real environment variables win). Native, no dependency. */
export function loadRepoEnv(): void {
  const file = resolve(import.meta.dirname, "../../../.env");
  if (!existsSync(file)) return;
  const before = { ...process.env };
  process.loadEnvFile(file);
  for (const [k, v] of Object.entries(before)) if (v !== undefined) process.env[k] = v;
}

const identifier = z.string().regex(/^[A-Za-z0-9_]{1,64}$/, "must be a plain MySQL identifier");

const EnvSchema = z.object({
  MYSQL_HOST: z.string().default("127.0.0.1"),
  MYSQL_PORT: z.coerce.number().int().default(3306),
  /** "true" for hosted MySQL that requires TLS (Aiven, Railway public proxy, etc.). */
  MYSQL_SSL: z.enum(["true", "false"]).default("false"),
  /** Optional CA certificate (PEM). "
" escapes are accepted so it fits in one env var. */
  MYSQL_SSL_CA: z.string().optional(),
  /** Admin user for setup/reset/tests ("root" locally; e.g. "avnadmin" on Aiven). */
  MYSQL_ROOT_USER: z.string().min(1).default("root"),
  MYSQL_ROOT_PASSWORD: z.string().min(1, "MYSQL_ROOT_PASSWORD is empty: add your MySQL root password to .env"),
  // Not "furniture_store_db": the original script drops that name, and it may already hold a user's own run of the script.
  APP_DB_NAME: identifier.default("furni_form_app"),
  LAB_DB_NAME: identifier.default("furniture_lab_db"),
  TEACHING_DB_NAME: identifier.default("furniture_teaching"),
  APP_DB_USER: identifier.default("furni_app"),
  APP_DB_PASSWORD: z.string().min(1),
  LAB_READER_USER: identifier.default("lab_reader"),
  LAB_READER_PASSWORD: z.string().min(1),
  LAB_OPERATOR_USER: identifier.default("lab_operator"),
  LAB_OPERATOR_PASSWORD: z.string().min(1),
  DEMO_ACCOUNT_PASSWORD: z.string().min(8),
});

export type DbConfig = z.infer<typeof EnvSchema>;

/** Subset used by the web server: it never receives root or lab credentials. */
const AppEnvSchema = EnvSchema.pick({
  MYSQL_HOST: true, MYSQL_PORT: true, MYSQL_SSL: true, MYSQL_SSL_CA: true, APP_DB_NAME: true, APP_DB_USER: true, APP_DB_PASSWORD: true,
});
export type AppDbConfig = z.infer<typeof AppEnvSchema>;
export function loadAppConfig(): AppDbConfig {
  return AppEnvSchema.parse(process.env);
}

/** Lab sandbox access for the web server: read-only and scenario users only, never root or the app user. */
const LabEnvSchema = EnvSchema.pick({
  MYSQL_HOST: true, MYSQL_PORT: true, MYSQL_SSL: true, MYSQL_SSL_CA: true, LAB_DB_NAME: true, TEACHING_DB_NAME: true,
  LAB_READER_USER: true, LAB_READER_PASSWORD: true, LAB_OPERATOR_USER: true, LAB_OPERATOR_PASSWORD: true,
});
export type LabDbConfig = z.infer<typeof LabEnvSchema>;
export function loadLabConfig(): LabDbConfig {
  return LabEnvSchema.parse(process.env);
}

export function loadConfig(overrides: Partial<Record<keyof DbConfig, string>> = {}): DbConfig {
  loadRepoEnv();
  return EnvSchema.parse({ ...process.env, ...overrides });
}
