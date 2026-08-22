import { test, expect, type Page } from "@playwright/test";
import { bootstrapSession, drainLoginGates, signIn } from "./helpers/auth.js";
import { ensurePaperExists } from "./helpers/papers.js";
import { e2eTwoUsersEnabled, e2eUserA, e2eUserB } from "./helpers/env.js";

/**
 * A context that is *not* already signed in.
 *
 * `browser.newContext()` inherits the project's `use.storageState`, which is the
 * saved session for user A. These tests are the only ones that build their own
 * contexts — the rest opt out with `test.use(...)` — so when that shared session
 * was introduced they silently started every "sign in as user B" against a page
 * that was already user A's dashboard. The login form never appeared, and the
 * failure read as a timeout waiting for a heading rather than as what it was.
 */
const CLEAN = { storageState: { cookies: [], origins: [] } };

/** This spec's own fixture, so what it grants does not depend on account history. */
const MEMBER_SHARE_PAPER = "E2E Member Share Paper";

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
    if (!e2eTwoUsersEnabled()) {
      testInfo.skip(true, "Set WEAVEFORGE_* env vars for both users");
    }
  });

  test("two users sign in and reach the app shell", async ({ browser }) => {
    const userA = e2eUserA();
    const userB = e2eUserB();

    const contextA = await browser.newContext(CLEAN);
    const contextB = await browser.newContext(CLEAN);
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

    const ownerCtx = await browser.newContext(CLEAN);
    const visitorCtx = await browser.newContext(CLEAN);
    const owner = await ownerCtx.newPage();
    const visitor = await visitorCtx.newPage();

    await bootstrapSession(owner, userA.email, userA.password);
    await ensurePaperExists(owner);
    await owner.getByRole("button", { name: "Share", exact: true }).first().click();
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

    const ownerCtx = await browser.newContext(CLEAN);
    const recipientCtx = await browser.newContext(CLEAN);
    const owner = await ownerCtx.newPage();
    const recipient = await recipientCtx.newPage();

    await bootstrapSession(owner, userA.email, userA.password);
    // A fixture of this spec's own, rather than whichever card happens to be
    // first. The first card is a fact about the account's history: it drifted
    // onto a paper that had already been shared with the recipient by an
    // earlier run, and a person who already has access is not offered again —
    // so the row this test waits for could never appear, and the failure named
    // the directory rather than the share that was already there.
    const paperTitle = MEMBER_SHARE_PAPER;
    await ensurePaperExists(owner, paperTitle);
    const card = owner.locator(".paper-card").filter({ hasText: paperTitle }).first();

    const handle = userB.email.split("@")[0]!;
    const memberRow = owner.locator(".mp-row").filter({ hasText: new RegExp(handle, "i") }).first();

    await card.getByRole("button", { name: "Share", exact: true }).click();
    // The dialog fetches the directory and the existing shares together, so
    // decide nothing about either until at least one row has arrived. A query
    // typed into an empty list filters to nothing, which used to read as
    // "recipient not in the directory" and skip the test outright — the one
    // assertion this spec exists for, silently not run.
    await owner.locator(".mp-row").first().waitFor({ timeout: 30_000 });

    const existing = owner.locator(".share-row").filter({ hasText: new RegExp(handle, "i") }).first();
    await expect(async () => {
      // Somebody who already has access is not offered again, so a grant left
      // behind by an earlier run makes the row this test needs *permanently*
      // absent — and typing the handle then empties the list rather than
      // filtering it, which is how a stale share showed up as a directory
      // that never loaded. Revoke first, then look again.
      if (await existing.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await existing.getByRole("button", { name: "remove" }).click();
        await expect(existing).toBeHidden({ timeout: 15_000 });
      }
      await owner.getByPlaceholder("Search people…").fill(handle);
      await expect(memberRow).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 90_000 });
    await memberRow.locator('input[type="checkbox"]').check();

    await confirmShareFingerprint(owner);
    // The grant button reads "Share (n)" once people are selected — it used to
    // say "Share with …".
    const grant = owner.locator(".share-add-submit");
    await expect(grant).toBeEnabled({ timeout: 15000 });
    await grant.click();
    await expect(owner.getByText(/Shared with|view-only link/i).first()).toBeVisible({ timeout: 20000 });

    await bootstrapSession(recipient, userB.email, userB.password);
    await recipient.goto("/shared");
    await expect(recipient.getByText(paperTitle, { exact: false }).first()).toBeVisible({ timeout: 30000 });

    await ownerCtx.close();
    await recipientCtx.close();
  });
});
