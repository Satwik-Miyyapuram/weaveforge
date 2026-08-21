import type { Page } from "@playwright/test";
import { DEFAULT_TEST_PASSWORD, e2eRecoveryLink } from "./env.js";

function unlockForm(page: Page) {
  return page.locator("form.crypto-setup-card").filter({
    has: page.getByRole("heading", { name: "Unlock encryption" }),
  });
}

async function isPastLoginGates(page: Page): Promise<boolean> {
  if (await page.locator(".layout.has-nav").isVisible({ timeout: 250 }).catch(() => false)) {
    return true;
  }
  if (/shared=1/.test(page.url())) return true;
  const linkRedeem = page.getByTestId("link-redeem");
  if (await linkRedeem.isVisible({ timeout: 250 }).catch(() => false)) {
    const unlock = page.getByRole("heading", { name: "Unlock encryption" });
    return !(await unlock.isVisible({ timeout: 250 }).catch(() => false));
  }
  return (
    await page
      .locator(".project-card, .project-list, .empty")
      .first()
      .isVisible({ timeout: 250 })
      .catch(() => false)
  );
}

async function isCryptoGateBusy(page: Page): Promise<boolean> {
  /* `.auth-loading` is set by WeaveForgeLoader (markAuthLoading) and is the
     only class the gate still renders — this used to be scoped to a
     `.crypto-gate-screen` ancestor that no component emits any more, so the
     wait below returned on its first iteration every time. */
  const busy = page.locator(".auth-loading");
  if (!(await busy.isVisible({ timeout: 200 }).catch(() => false))) return false;
  const text = (await busy.innerText().catch(() => "")) ?? "";
  return /unlocking|loading/i.test(text);
}

async function waitForCryptoGateIdle(page: Page, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await isPastLoginGates(page)) return;
    if (!(await isCryptoGateBusy(page))) return;
    await page.waitForTimeout(150);
  }
}

/** Submit the unlock gate once; waits for crypto setup to finish. */
export async function completeUnlockGate(page: Page, password = DEFAULT_TEST_PASSWORD) {
  if (await isPastLoginGates(page)) return;

  const recoverySetup = page.getByRole("heading", { name: "Set up email recovery" });
  if (await recoverySetup.isVisible({ timeout: 500 }).catch(() => false)) {
    const recoveryLink = e2eRecoveryLink();
    if (!recoveryLink) {
      throw new Error("E2E email recovery setup is required. Set E2E_RECOVERY_LINK to a manually prepared one-time recovery URL.");
    }
    await page.goto(recoveryLink);
    await page.locator(".layout.has-nav, .project-list, .project-card, .empty").first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
    return;
  }

  const heading = page.getByRole("heading", { name: "Unlock encryption" });
  if (!(await heading.isVisible({ timeout: 5000 }).catch(() => false))) return;
  if (await isPastLoginGates(page)) return;

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await isPastLoginGates(page)) return;

    await waitForCryptoGateIdle(page);

    if (!(await heading.isVisible({ timeout: 300 }).catch(() => false))) {
      if (await isPastLoginGates(page)) return;
      await page.waitForTimeout(200);
      continue;
    }

    const passwordInput = page.locator("form.crypto-setup-card input[name='password']");
    const legacyInput = page.locator("form.crypto-setup-card input[name='passphrase']");
    const target = (await passwordInput.isVisible({ timeout: 500 }).catch(() => false))
      ? passwordInput
      : (await legacyInput.isVisible({ timeout: 300 }).catch(() => false))
        ? legacyInput
        : null;

    if (!target) {
      await page.waitForTimeout(300);
      continue;
    }

    try {
      await target.fill(password, { timeout: 5000 });
    } catch {
      // Form often unmounts when auto-unlock wins the race — treat as success if gates cleared.
      if (await isPastLoginGates(page)) return;
      await page.waitForTimeout(300);
      continue;
    }

    const form = unlockForm(page);
    const unlockBtn = form.getByRole("button", { name: /^Unlock/i });
    if (await unlockBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await unlockBtn.click({ timeout: 5000 }).catch(async () => {
        if (await isPastLoginGates(page)) return;
        await target.press("Enter").catch(() => {});
      });
    } else {
      await target.press("Enter").catch(() => {});
    }

    await page
      .locator(".layout.has-nav, .project-list, .project-card, .empty")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 })
      .catch(() => {});

    if (await isPastLoginGates(page)) return;
    await page.waitForTimeout(300);
  }
}

async function waitForAuthIdle(page: Page): Promise<void> {
  await page.locator(".auth-loading").waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {});
}

async function isLoginFormVisible(page: Page): Promise<boolean> {
  return page.getByRole("heading", { name: "Sign in", exact: true }).isVisible({ timeout: 300 }).catch(() => false);
}

/** Fill email/password on the login screen (must already be visible). */
async function submitLoginForm(page: Page, email: string, password: string) {
  await waitForAuthIdle(page);
  const signInHeading = page.getByRole("heading", { name: "Sign in", exact: true });
  await signInHeading.waitFor({ state: "visible", timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await signInHeading.waitFor({ state: "hidden", timeout: 45_000 });
}

/** Leave an authenticated crypto gate and open the login form. */
async function openLoginForm(page: Page): Promise<void> {
  const signInAgainHeading = page.getByRole("heading", { name: "Sign in again" });
  if (await signInAgainHeading.isVisible({ timeout: 500 }).catch(() => false)) {
    await page.getByRole("button", { name: "Sign in again", exact: true }).click();
    await signInAgainHeading.waitFor({ state: "hidden", timeout: 30_000 });
    await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    return;
  }

  if (await isLoginFormVisible(page)) return;

  await page.goto("/dashboard");
  await waitForAuthIdle(page);
}

export async function signIn(page: Page, email: string, password = DEFAULT_TEST_PASSWORD) {
  if (await isPastLoginGates(page)) return;

  await openLoginForm(page);

  if (await isPastLoginGates(page)) return;
  if (!(await isLoginFormVisible(page))) {
    await page.goto("/dashboard");
    await waitForAuthIdle(page);
  }

  await submitLoginForm(page, email, password);
  await completeUnlockGate(page, password);
}

/** Drain privacy, crypto, and org gates until the project picker or main shell is reachable. */
export async function drainLoginGates(
  page: Page,
  password = DEFAULT_TEST_PASSWORD,
  email?: string,
) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await isPastLoginGates(page)) return;

    const disclaimer = page.getByRole("button", { name: "I understand — continue" });
    if (await disclaimer.isVisible({ timeout: 500 }).catch(() => false)) {
      await disclaimer.click();
      continue;
    }

    if (await isCryptoGateBusy(page)) {
      await waitForCryptoGateIdle(page);
      continue;
    }

    const signInHeading = page.getByRole("heading", { name: "Sign in", exact: true });
    if (await signInHeading.isVisible({ timeout: 500 }).catch(() => false)) {
      if (email) {
        await submitLoginForm(page, email, password);
        await completeUnlockGate(page, password);
      }
      continue;
    }

    const signInAgainHeading = page.getByRole("heading", { name: "Sign in again" });
    if (await signInAgainHeading.isVisible({ timeout: 500 }).catch(() => false)) {
      if (email) {
        await page.getByRole("button", { name: "Sign in again", exact: true }).click();
        await signInAgainHeading.waitFor({ state: "hidden", timeout: 30_000 });
        await submitLoginForm(page, email, password);
        await completeUnlockGate(page, password);
      }
      continue;
    }

    const unlockHeading = page.getByRole("heading", { name: "Unlock encryption" });
    if (await unlockHeading.isVisible({ timeout: 500 }).catch(() => false)) {
      if (!(await isPastLoginGates(page))) {
        await completeUnlockGate(page, password);
      }
      continue;
    }

    const standalone = page.getByRole("button", { name: /Continue without an org/i });
    if (await standalone.isVisible({ timeout: 500 }).catch(() => false)) {
      await standalone.click();
      continue;
    }

    await page.waitForTimeout(300);
  }
}

export async function acceptDisclaimerIfShown(page: Page) {
  const btn = page.getByRole("button", { name: "I understand — continue" });
  if (await btn.isVisible({ timeout: 8000 }).catch(() => false)) {
    await btn.click();
  }
}

export async function unlockIfNeeded(page: Page, password = DEFAULT_TEST_PASSWORD) {
  await completeUnlockGate(page, password);
}

export async function passOrgSetupIfShown(page: Page) {
  const standalone = page.getByRole("button", { name: /Continue without an org/i });
  if (await standalone.isVisible({ timeout: 15000 }).catch(() => false)) {
    await standalone.click();
    await page
      .locator(".project-card, .project-list, .layout.has-nav")
      .first()
      .waitFor({ timeout: 20000 });
  }
}

export async function ensureProjectSelected(page: Page) {
  const shell = page.locator(".layout.has-nav");
  if (await shell.isVisible({ timeout: 2000 }).catch(() => false)) return;

  await page
    .locator(".project-list, .project-card, .empty")
    .first()
    .waitFor({ timeout: 30000 });

  const projectCard = page.locator(".project-card").first();
  if (await projectCard.isVisible({ timeout: 5000 }).catch(() => false)) {
    await projectCard.click();
    await shell.waitFor({ timeout: 30000 });
    return;
  }

  const newProject = page.getByRole("button", { name: "+ New project" });
  if (await newProject.isVisible({ timeout: 5000 }).catch(() => false)) {
    await newProject.click();
    await page.locator("#pname").fill("E2E Project");
    await page.getByRole("button", { name: "Create project" }).click();
    await shell.waitFor({ timeout: 30000 });
    return;
  }

  await shell.waitFor({ timeout: 30000 });
}

/** Sign in, pass privacy + crypto gates, and land in the main shell. */
export async function bootstrapSession(
  page: Page,
  email: string,
  password = DEFAULT_TEST_PASSWORD,
  opts?: { keepUrl?: boolean },
) {
  if (opts?.keepUrl) {
    await drainLoginGates(page, password);
    return;
  }
  await signIn(page, email, password);
  await drainLoginGates(page, password, email);
  await ensureProjectSelected(page);
}

/** Wait for the main shell (project selected, crypto + org gates passed). */
export async function waitForAppShell(
  page: Page,
  password = DEFAULT_TEST_PASSWORD,
  email?: string,
  ms = 60_000,
) {
  await drainLoginGates(page, password, email);
  await page.locator(".layout.has-nav").waitFor({ state: "visible", timeout: ms });
}

export type BrowserPersistence = {
  sessionStorage: Record<string, string>;
  localStorage: Record<string, string>;
};

/** Snapshot crypto session + app prefs for Playwright context restore (storageState omits these). */
export async function captureBrowserPersistence(page: Page): Promise<BrowserPersistence> {
  return page.evaluate(() => {
    const sessionStorage: Record<string, string> = {};
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (!key) continue;
      const val = window.sessionStorage.getItem(key);
      if (val != null) sessionStorage[key] = val;
    }
    const localStorage: Record<string, string> = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || (!key.startsWith("tt:") && !key.startsWith("thesis."))) continue;
      const val = window.localStorage.getItem(key);
      if (val != null) localStorage[key] = val;
    }
    return { sessionStorage, localStorage };
  });
}

/** Inject captured session/local storage before the app boots in a new context. */
export function installBrowserPersistence(
  context: import("@playwright/test").BrowserContext,
  persistence: BrowserPersistence,
) {
  context.addInitScript((data) => {
    for (const [key, value] of Object.entries(data.sessionStorage)) {
      window.sessionStorage.setItem(key, value);
    }
    for (const [key, value] of Object.entries(data.localStorage)) {
      window.localStorage.setItem(key, value);
    }
  }, persistence);
}
