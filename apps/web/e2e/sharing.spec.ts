import { test, expect, type Page } from "@playwright/test";
import { bootstrapSession, drainLoginGates, signIn } from "./helpers/auth.js";
import { ensurePaperExists, firstPaperTitle } from "./helpers/papers.js";
import { e2eEnabled, e2eUserA, e2eUserB } from "./helpers/env.js";

async function confirmShareFingerprint(page: Page) {
  const fp = page.locator(".share-fingerprint").first();
  if (!(await fp.isVisible({ timeout: 5000 }).catch(() => false))) return;
  const raw = await fp.innerText();
  const hex = raw.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  const formatted = hex.match(/.{1,4}/g)?.join(" ") ?? raw.trim();
  await page.locator(".share-fingerprint-input").first().fill(formatted);
}

test.describe("sharing", () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(({ }, testInfo) => {
    if (!e2eEnabled()) {
      testInfo.skip(true, "Set WEAVEFORGE_* env vars for both users");
    }
  });

  test("two users sign in and reach the app shell", async ({ browser }) => {
    const userA = e2eUserA();
    const userB = e2eUserB();

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await bootstrapSession(pageA, userA.email, userA.password);
    await bootstrapSession(pageB, userB.email, userB.password);

    await expect(pageA.locator(".layout.has-nav")).toBeVisible();
    await expect(pageB.locator(".layout.has-nav")).toBeVisible();

    await contextA.close();
    await contextB.close();
  });

  test("share link: owner creates link, visitor redeems", async ({ browser }) => {
    const userA = e2eUserA();
    const userB = e2eUserB();

    const ownerCtx = await browser.newContext();
    const visitorCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    const visitor = await visitorCtx.newPage();

    await bootstrapSession(owner, userA.email, userA.password);
    await ensurePaperExists(owner);
    await owner.getByRole("button", { name: "share", exact: true }).first().click();
    await owner.getByRole("button", { name: "Create view link" }).click();
    const linkUrlEl = owner.getByTestId("share-link-url");
    await expect(linkUrlEl).toBeVisible({ timeout: 20_000 });
    const linkUrl = (await linkUrlEl.innerText()).trim();
    expect(linkUrl).toContain("/link?t=");

    await signIn(visitor, userB.email, userB.password);
    await visitor.goto(linkUrl);
    await drainLoginGates(visitor, userB.password);

    await expect(visitor.locator(".error")).not.toBeVisible({ timeout: 5000 });
    await expect(visitor).toHaveURL(/shared=1/, { timeout: 60000 });

    await ownerCtx.close();
    await visitorCtx.close();
  });

  test("member share: owner grants access, recipient sees shared item", async ({ browser }) => {
    const userA = e2eUserA();
    const userB = e2eUserB();

    const ownerCtx = await browser.newContext();
    const recipientCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    const recipient = await recipientCtx.newPage();

    await bootstrapSession(owner, userA.email, userA.password);
    await ensurePaperExists(owner);
    const paperTitle = await firstPaperTitle(owner);

    await owner.getByRole("button", { name: "share", exact: true }).first().click();
    await owner.getByPlaceholder("Search people…").fill(userB.email.split("@")[0]!);
    const memberRow = owner.locator(".mp-row").filter({ hasText: new RegExp(userB.email.split("@")[0]!, "i") }).first();
    if (!(await memberRow.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip(true, "Recipient not in lab directory — run seed-test-users or join same org");
    }
    await memberRow.locator('input[type="checkbox"]').check();

    await confirmShareFingerprint(owner);
    await expect(owner.getByRole("button", { name: /Share with/i })).toBeEnabled({ timeout: 15000 });
    await owner.getByRole("button", { name: /Share with/i }).click();
    await expect(owner.getByText(/Shared with|view-only link/i).first()).toBeVisible({ timeout: 20000 });

    await bootstrapSession(recipient, userB.email, userB.password);
    await recipient.goto("/shared");
    await expect(recipient.getByText(paperTitle, { exact: false })).toBeVisible({ timeout: 30000 });

    await ownerCtx.close();
    await recipientCtx.close();
  });
});
