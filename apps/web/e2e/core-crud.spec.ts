import { expect, test, type Page } from "@playwright/test";
import { bootstrapSession } from "./helpers/auth.js";
import { e2eEnabled, e2eUserA } from "./helpers/env.js";

test.use({ storageState: { cookies: [], origins: [] } });

/** Capture PostgREST writes that domain CRUD must use (not Next /api). */
function trackRestWrites(page: Page, table: string) {
  const hits: string[] = [];
  page.on("request", (req) => {
    if (!/\/rest\/v1\//.test(req.url())) return;
    if (!req.url().includes(`/${table}`)) return;
    if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method())) return;
    hits.push(`${req.method()} ${req.url()}`);
  });
  return hits;
}

test.describe("core domain CRUD (PostgREST + RLS)", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }, testInfo) => {
    if (!e2eEnabled()) testInfo.skip(true, "Set THESIS_TRACKER_* env vars for the E2E user");
    const user = e2eUserA();
    await bootstrapSession(page, user.email, user.password);
  });

  test("papers: create via UI hits PostgREST papers upsert", async ({ page }) => {
    const writes = trackRestWrites(page, "papers");
    const title = `E2E Paper ${Date.now()}`;

    await page.goto("/papers");
    await page.getByRole("button", { name: "+ Add paper" }).click();
    await page.locator("#title").fill(title);
    await page.getByRole("button", { name: "Add paper", exact: true }).click();

    await expect(page.getByText(title, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    expect(writes.some((w) => /POST|PUT|PATCH/.test(w))).toBeTruthy();
  });

  test("vault: create note via UI hits PostgREST vault_pages", async ({ page }) => {
    const writes = trackRestWrites(page, "vault_pages");
    const title = `E2E Note ${Date.now()}`;

    await page.goto("/notes");
    await page.getByRole("button", { name: "+ New note" }).click();
    await page.locator("#note-title").fill(title);
    await page.getByRole("button", { name: "Create note", exact: true }).click();

    await expect(page.getByText(title, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    expect(writes.some((w) => /POST|PUT|PATCH/.test(w))).toBeTruthy();
  });

  test("logbook: add entry via UI hits PostgREST log_entries", async ({ page }) => {
    const writes = trackRestWrites(page, "log_entries");
    const body = `E2E log ${Date.now()} — wrote tests for CRUD.`;

    await page.goto("/log");
    await page.getByRole("button", { name: "+ Add entry" }).click();
    await page.locator("#body").fill(body);
    await page.getByRole("button", { name: "Add log entry", exact: true }).click();

    await expect(page.getByText(body, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    expect(writes.some((w) => /POST|PUT|PATCH/.test(w))).toBeTruthy();
  });
});
