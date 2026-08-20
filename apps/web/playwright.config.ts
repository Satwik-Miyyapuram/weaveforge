import { defineConfig, devices } from "@playwright/test";
import { loadLocalDevEnv } from "./e2e/helpers/load-local-dev-env";
import { e2eEnabled } from "./e2e/helpers/env.js";

loadLocalDevEnv();

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3210";
const ci = Boolean(process.env.CI);
const enabled = e2eEnabled();
const port = new URL(baseURL).port || (ci ? "3000" : "3100");

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: 1,
  reporter: ci ? "github" : "list",
  timeout: 120_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "on-first-retry",
    storageState: e2eEnabled() ? "e2e/.auth/user-a.json" : undefined,
    // Sandboxes and CI images that ship one Chromium of their own rather than
    // the exact build this Playwright expects can point at it, instead of every
    // caller re-downloading a browser they already have.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  webServer: !enabled || process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        // CI: serve pre-built app (fast). Local: dev server with HMR.
        command: ci ? `npm run start -- -p ${port}` : `npm run dev -- -p ${port}`,
        url: baseURL,
        reuseExistingServer: !ci,
        timeout: ci ? 60_000 : 120_000,
        cwd: process.cwd(),
      },
});
