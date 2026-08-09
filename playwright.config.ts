import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  globalTeardown: "./tests/e2e/teardown.ts",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4399",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/start-test-site.mjs",
    url: "http://127.0.0.1:4399/cms/",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
