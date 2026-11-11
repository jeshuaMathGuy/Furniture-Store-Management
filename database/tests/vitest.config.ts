import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["database/tests/**/*.test.ts"],
    globalSetup: ["database/tests/global-setup.ts"],
    // Files share one MySQL server and some measure lock waits: run them one at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
    reporters: ["verbose"],
  },
});
