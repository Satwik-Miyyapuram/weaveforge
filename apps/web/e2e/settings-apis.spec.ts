import { expect, test } from "@playwright/test";
import { bootstrapSession } from "./helpers/auth.js";
import { e2eEnabled, e2eUserA } from "./helpers/env.js";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("settings privileged APIs", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }, testInfo) => {
    if (!e2eEnabled()) testInfo.skip(true, "Set THESIS_TRACKER_* env vars for the E2E user");
    const user = e2eUserA();
    await bootstrapSession(page, user.email, user.password);
  });

  test("settings load uses /api/settings/credentials for sealed secrets", async ({ page }) => {
    const credentialGets: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/settings/credentials") && req.method() === "GET") {
        credentialGets.push(req.url());
      }
    });

    await page.goto("/settings");
    await expect(page.getByText("AI & MCP", { exact: false }).first()).toBeVisible({ timeout: 30_000 });

    // Repo loads secrets through the Next credentials route (server-key seal).
    await expect.poll(() => credentialGets.length, { timeout: 20_000 }).toBeGreaterThan(0);
  });

  test("API tokens panel talks to /api/settings/api-tokens", async ({ page }) => {
    const tokenGets: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/settings/api-tokens") && req.method() === "GET") {
        tokenGets.push(req.url());
      }
    });

    await page.goto("/settings");
    await expect(page.getByText("Python SDK access tokens").first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => tokenGets.length, { timeout: 20_000 }).toBeGreaterThan(0);
  });

  test("MCP tokens load via /api/settings/mcp-tokens when AI access is enabled", async ({ page }) => {
    const mcpGets: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/settings/mcp-tokens") && req.method() === "GET") {
        mcpGets.push(req.url());
      }
    });

    await page.goto("/settings");
    await page.getByRole("button", { name: /AI assistant access/i }).click();
    const enable = page.getByRole("switch", { name: "Enable AI assistant access" });
    await expect(enable).toBeVisible({ timeout: 15_000 });
    if ((await enable.getAttribute("aria-checked")) !== "true") {
      await enable.click();
    }
    await expect.poll(() => mcpGets.length, { timeout: 20_000 }).toBeGreaterThan(0);
  });
});
