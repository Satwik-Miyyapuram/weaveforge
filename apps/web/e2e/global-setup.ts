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
  if (!e2eEnabled() || process.env.PLAYWRIGHT_NO_SESSION === "1") return;
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
