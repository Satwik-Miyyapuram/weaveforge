/**
 * Record short WebM demo clips for the README (one per major screen).
 *
 *   npm run record:demos --workspace @weaveforge/web
 *
 * Requires a running app (starts dev server unless PLAYWRIGHT_SKIP_WEBSERVER=1)
 * and a seeded account (credentials in local-dev/test-accounts.env).
 *
 * Signs in once off-camera, then records each scenario from the dashboard
 * using a restored session (no login form in the clips).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, readFileSync, rename, rm, copyFile, unlink, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bootstrapSession,
  captureBrowserPersistence,
  installBrowserPersistence,
  waitForAppShell,
  type BrowserPersistence,
} from "../helpers/auth.js";
import { chromium, type Browser, type BrowserContextOptions } from "playwright";
import { DEFAULT_TEST_PASSWORD } from "../helpers/env.js";
import { DEMO_SCENARIOS, type DemoScenario } from "./scenarios.js";
import { loadLocalDevEnv } from "../helpers/load-local-dev-env.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..", "..");
const CLIPS_DIR = resolve(ROOT, "docs/demo/clips");
const TMP_DIR = resolve(CLIPS_DIR, ".tmp");
const VIEWPORT = { width: 960, height: 640 };

const DEMO_EMAIL = process.env.DEMO_CLIP_EMAIL ?? "c@example.com";
const DEMO_PASSWORD = process.env.DEMO_CLIP_PASSWORD ?? DEFAULT_TEST_PASSWORD;
const BASE_URL = (process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const ONLY = process.env.DEMO_CLIP_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
const SKIP_EXISTING = process.env.DEMO_SKIP_EXISTING !== "0";

async function clipAlreadyRecorded(id: string): Promise<boolean> {
  if (!SKIP_EXISTING) return false;
  try {
    const info = await stat(resolve(CLIPS_DIR, `${id}.webm`));
    return info.size > 10_000;
  } catch {
    return false;
  }
}

function loadEnvLocal() {
  const path = resolve(ROOT, "apps/web/.env.local");
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const key = t.slice(0, i).trim();
      const val = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* optional */
  }
}

async function waitForServer(url: string, ms = 120_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 401) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`App not reachable at ${url}`);
}

function startDevServer(): ChildProcess | null {
  if (process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1") return null;
  const child = spawn("npm run dev", {
    cwd: resolve(ROOT, "apps/web"),
    shell: true,
    stdio: "ignore",
    env: { ...process.env, PORT: "3000" },
  });
  return child;
}

const SHOWCASE_PROJECT = process.env.DEMO_SHOWCASE_PROJECT ?? "MSc Thesis (Showcase)";

function projectSwitcher(page: import("@playwright/test").Page) {
  return page.locator(".nav .proj-switcher");
}

async function ensureNavExpanded(page: import("@playwright/test").Page) {
  const collapsed = await page
    .locator(".layout.nav-collapsed")
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (!collapsed) return;
  await page.locator(".menu-toggle").click();
  await projectSwitcher(page).waitFor({ state: "visible", timeout: 5000 });
}

async function selectShowcaseProject(page: import("@playwright/test").Page) {
  const shell = page.locator(".layout.has-nav");

  async function onShowcaseProject(): Promise<boolean> {
    const chip = projectSwitcher(page).locator(".proj-chip");
    if (!(await chip.isVisible({ timeout: 1500 }).catch(() => false))) return false;
    const text = await chip.innerText();
    return text.includes(SHOWCASE_PROJECT);
  }

  if (await shell.isVisible({ timeout: 2000 }).catch(() => false)) {
    await ensureNavExpanded(page);
    if (await onShowcaseProject()) return;

    const switcher = projectSwitcher(page);
    await switcher.locator(".proj-chip").click();
    const item = switcher.locator(".proj-menu-item").filter({ hasText: SHOWCASE_PROJECT }).first();
    if (await item.isVisible({ timeout: 5000 }).catch(() => false)) {
      await item.click();
      await page.waitForTimeout(800);
      if (await switcher.isVisible({ timeout: 1000 }).catch(() => false)) {
        const name = await switcher.locator(".proj-chip").innerText();
        if (!name.includes(SHOWCASE_PROJECT)) {
          throw new Error(`Failed to switch to "${SHOWCASE_PROJECT}"`);
        }
      }
      return;
    }

    const allProjects = switcher.getByRole("button", { name: /New \/ all projects/i });
    if (await allProjects.isVisible({ timeout: 2000 }).catch(() => false)) {
      await allProjects.click();
      const showcase = page.locator(".project-card").filter({ hasText: SHOWCASE_PROJECT });
      if (await showcase.isVisible({ timeout: 8000 }).catch(() => false)) {
        await showcase.click();
        await shell.waitFor({ state: "visible", timeout: 30_000 });
        return;
      }
    }

    throw new Error(
      `Showcase project "${SHOWCASE_PROJECT}" not in project switcher. Run: npm run seed:showcase`,
    );
  }

  const showcase = page.locator(".project-card").filter({ hasText: SHOWCASE_PROJECT });
  if (await showcase.isVisible({ timeout: 5000 }).catch(() => false)) {
    await showcase.click();
    await shell.waitFor({ state: "visible", timeout: 30_000 });
    return;
  }

  throw new Error(
    `Showcase project "${SHOWCASE_PROJECT}" not found. Run: npm run seed:showcase`,
  );
}

async function moveVideo(src: string, dest: string) {
  try {
    await rename(src, dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EEXIST") throw err;
    await copyFile(src, dest);
    await unlink(src).catch(() => {});
  }
}

type DemoSession = {
  storageState: NonNullable<BrowserContextOptions["storageState"]>;
  persistence: BrowserPersistence;
};

/** Login once (off-camera), select showcase, land on dashboard — returns saved session. */
async function bootstrapDemoSession(browser: Browser): Promise<DemoSession> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  try {
    console.log(`Signing in as ${DEMO_EMAIL}…`);
    await bootstrapSession(page, DEMO_EMAIL, DEMO_PASSWORD);
    await selectShowcaseProject(page);
    await page.goto("/dashboard");
    await waitForAppShell(page, DEMO_PASSWORD, DEMO_EMAIL);
    await page.waitForTimeout(500);
    return {
      storageState: await context.storageState(),
      persistence: await captureBrowserPersistence(page),
    };
  } finally {
    await context.close();
  }
}

/** Land on dashboard with showcase project (persistence injected before page open). */
async function prepareClipPage(page: import("@playwright/test").Page) {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.locator(".auth-loading").waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {});
  await waitForAppShell(page, DEMO_PASSWORD, DEMO_EMAIL);
  await selectShowcaseProject(page);
  await page.waitForTimeout(400);
}

async function recordOne(browser: Browser, scenario: DemoScenario, session: DemoSession) {
  mkdirSync(TMP_DIR, { recursive: true });
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: VIEWPORT,
    storageState: session.storageState,
    recordVideo: { dir: TMP_DIR, size: VIEWPORT },
    deviceScaleFactor: 1,
  });
  installBrowserPersistence(context, session.persistence);
  const page = await context.newPage();
  const dest = resolve(CLIPS_DIR, `${scenario.id}.webm`);

  try {
    console.log(`  · ${scenario.id} — ${scenario.title}`);
    await prepareClipPage(page);
    await scenario.run(page);
    await page.waitForTimeout(Math.round((scenario.holdSec ?? 2) * 1000));
  } finally {
    const video = page.video();
    await context.close();
    if (video) {
      const src = await video.path();
      await moveVideo(src, dest);
    }
  }

  return dest;
}

function writeManifest(files: { id: string; title: string; file: string }[]) {
  const manifest = {
    generatedAt: new Date().toISOString(),
    viewport: VIEWPORT,
    account: DEMO_EMAIL,
    clips: files,
  };
  writeFileSync(resolve(CLIPS_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function main() {
  loadLocalDevEnv(ROOT);
  loadEnvLocal();
  mkdirSync(CLIPS_DIR, { recursive: true });
  await rm(TMP_DIR, { recursive: true, force: true });

  const scenarios = ONLY?.length
    ? DEMO_SCENARIOS.filter((s) => ONLY.includes(s.id))
    : DEMO_SCENARIOS;

  if (scenarios.length === 0) {
    console.error("No scenarios matched DEMO_CLIP_ONLY");
    process.exit(1);
  }

  const dev = startDevServer();
  try {
    console.log(`Waiting for ${BASE_URL}…`);
    await waitForServer(BASE_URL);
    const browser = await chromium.launch({ headless: true });
    const recorded: { id: string; title: string; file: string }[] = [];
    try {
      const session = await bootstrapDemoSession(browser);
      const pending: DemoScenario[] = [];
      for (const scenario of scenarios) {
        if (await clipAlreadyRecorded(scenario.id)) {
          console.log(`  · ${scenario.id} — ${scenario.title} (skipped, already recorded)`);
          recorded.push({
            id: scenario.id,
            title: scenario.title,
            file: `docs/demo/clips/${scenario.id}.webm`,
          });
        } else {
          pending.push(scenario);
        }
      }

      console.log(`Recording ${pending.length} clip(s) from dashboard…\n`);

      for (const scenario of pending) {
        const path = await recordOne(browser, scenario, session);
        recorded.push({ id: scenario.id, title: scenario.title, file: `docs/demo/clips/${scenario.id}.webm` });
        console.log(`    → ${path}`);
      }
    } finally {
      await browser.close();
    }

    writeManifest(recorded.sort((a, b) => {
      const order = DEMO_SCENARIOS.map((s) => s.id);
      return order.indexOf(a.id) - order.indexOf(b.id);
    }));
    console.log(`\nDone — ${recorded.length} clip(s) in docs/demo/clips/`);
  } finally {
    if (dev) {
      dev.kill("SIGTERM");
    }
    await rm(TMP_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
