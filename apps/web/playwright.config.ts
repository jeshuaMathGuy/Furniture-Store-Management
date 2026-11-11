import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Auth tests need only the demo-account password. Read that single value from the repository .env,
// so the server Playwright starts never inherits root or lab credentials.
const repoEnv = resolve(import.meta.dirname, "../../.env");
if (!process.env.DEMO_ACCOUNT_PASSWORD && existsSync(repoEnv)) {
  const m = /^DEMO_ACCOUNT_PASSWORD=(.*)$/m.exec(readFileSync(repoEnv, "utf8"));
  if (m) process.env.DEMO_ACCOUNT_PASSWORD = m[1]!.trim();
}
import { e2eDbNames } from "./e2e/db-names";

// Parallel-safe: each run can choose its own port, build folder (NEXT_DIST_DIR) and databases (E2E_DB_PREFIX).
const PORT = Number(process.env.E2E_PORT ?? 3100);
const DB = e2eDbNames();
// Use the Microsoft Edge that ships with Windows (no browser download). Override with PW_CHANNEL=chromium etc.
const channel = process.env.PW_CHANNEL ?? "msedge";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Headless WebGL is memory-hungry; two workers keep the machine responsive.
  workers: 2,
  retries: 0,
  forbidOnly: true,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Tests run against a production build (`next build` runs first via the e2e script).
  globalSetup: "./e2e/global-setup.ts",
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: `pnpm exec next start -p ${PORT}`,
    // /login renders without touching the database, so the server can come up before global setup builds the schemas.
    url: `http://127.0.0.1:${PORT}/login`,
    env: { APP_DB_NAME: DB.app, LAB_DB_NAME: DB.lab, TEACHING_DB_NAME: DB.teaching, NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? ".next" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel }, testIgnore: /responsive.spec.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"], channel }, testMatch: /responsive\.spec\.ts/ },
  ],
});
