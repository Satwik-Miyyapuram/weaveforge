import { chromium, type FullConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { bootstrapSession } from "./helpers/auth.js";
import { e2eEnabled, e2eUserA } from "./helpers/env.js";

// Playwright loads this setup through the project's CommonJS TS transform.
// Resolve from its configured app cwd rather than relying on `import.meta`.
const AUTH_DIR = path.join(process.cwd(), "e2e", ".auth");
const USER_A_STATE = path.join(AUTH_DIR, "user-a.json");

export default async function globalSetup(_config: FullConfig) {
  if (process.env.PLAYWRIGHT_NO_SESSION === "1") return;
  if (!e2eEnabled()) {
    // A checkout without credentials is expected to skip. A CI job that went to
    // the trouble of configuring this suite is not: it once passed A's secrets
    // and not B's, every spec skipped, and the job reported success for months.
    if (process.env.CI) throw new Error("E2E credentials are missing: the suite would skip every spec and report success.");
    return;
  }
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3100" });
  const page = await context.newPage();
  const user = e2eUserA();

  try {
    await bootstrapSession(page, user.email, user.password);
    await page.context().storageState({ path: USER_A_STATE });
  } finally {
    await browser.close();
  }
}
