import type { Page } from "@playwright/test";
import { DEFAULT_TEST_PASSWORD } from "./env.js";
import { appeared } from "./visible.js";

async function isPastLoginGates(page: Page): Promise<boolean> {
  if (await appeared(page.locator(".layout.has-nav"), 250)) {
    return true;
  }
  if (/shared=1/.test(page.url())) return true;
  const linkRedeem = page.getByTestId("link-redeem");
  if (await appeared(linkRedeem, 250)) return true;
  return appeared(page.locator(".project-card, .project-list, .empty").first(), 250);
}

async function isCryptoGateBusy(page: Page): Promise<boolean> {
  /* `.auth-loading` is set by WeaveForgeLoader (markAuthLoading) and is the
     only class the gate still renders — this used to be scoped to a
     `.crypto-gate-screen` ancestor that no component emits any more, so the
     wait below returned on its first iteration every time. */
  const busy = page.locator(".auth-loading");
  if (!(await appeared(busy, 200))) return false;
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

async function waitForAuthIdle(page: Page): Promise<void> {
  await page.locator(".auth-loading").waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {});
}

async function isLoginFormVisible(page: Page): Promise<boolean> {
  return appeared(page.getByRole("heading", { name: "Sign in", exact: true }), 300);
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

/** Leave an authenticated session and open the login form. */
async function openLoginForm(page: Page): Promise<void> {
  const signInAgainHeading = page.getByRole("heading", { name: "Sign in again" });
  if (await appeared(signInAgainHeading, 500)) {
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
}

/** Drain privacy and org gates until the project picker or main shell is reachable. */
export async function drainLoginGates(
  page: Page,
  password = DEFAULT_TEST_PASSWORD,
  email?: string,
) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await isPastLoginGates(page)) return;

    const disclaimer = page.getByRole("button", { name: "I understand — continue" });
    if (await appeared(disclaimer, 500)) {
      await disclaimer.click();
      continue;
    }

    if (await isCryptoGateBusy(page)) {
      await waitForCryptoGateIdle(page);
      continue;
    }

    const signInHeading = page.getByRole("heading", { name: "Sign in", exact: true });
    if (await appeared(signInHeading, 500)) {
      if (email) {
        await submitLoginForm(page, email, password);
      }
      continue;
    }

    const signInAgainHeading = page.getByRole("heading", { name: "Sign in again" });
    if (await appeared(signInAgainHeading, 500)) {
      if (email) {
        await page.getByRole("button", { name: "Sign in again", exact: true }).click();
        await signInAgainHeading.waitFor({ state: "hidden", timeout: 30_000 });
        await submitLoginForm(page, email, password);
      }
      continue;
    }

    const standalone = page.getByRole("button", { name: /Continue without an org/i });
    if (await appeared(standalone, 500)) {
      await standalone.click();
      continue;
    }

    await page.waitForTimeout(300);
  }
}

export async function ensureProjectSelected(page: Page) {
  const shell = page.locator(".layout.has-nav");
  if (await appeared(shell, 2000)) return;

  await page
    .locator(".project-list, .project-card, .empty")
    .first()
    .waitFor({ timeout: 30000 });

  const projectCard = page.locator(".project-card").first();
  if (await appeared(projectCard, 5000)) {
    await projectCard.click();
    await shell.waitFor({ timeout: 30000 });
    return;
  }

  const newProject = page.getByRole("button", { name: "+ New project" });
  if (await appeared(newProject, 5000)) {
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
