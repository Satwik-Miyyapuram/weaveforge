#!/usr/bin/env node
/**
 * Screenshots of the real app for the user docs.
 *
 * Reads scripts/user-docs/shots.json, drives a running WeaveForge web app with
 * Playwright (chromium, 1280x800), outlines the step's element and writes
 * docs/.site/shots/<page>/<task>/<step>.<theme>.png. Elements are found only by
 * `data-help-id`, so a renamed button fails here instead of shipping a stale picture.
 *
 *   node scripts/capture-docs-shots.mjs [--base http://localhost:3000]
 *        [--themes light,dark | all] [--only <page>]
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", ".site", "shots");
const SHOTS = JSON.parse(readFileSync(join(ROOT, "scripts", "user-docs", "shots.json"), "utf8"));

// Theme ids as apps/web/src/lib/theme/theme.ts lists them.
const LIGHT = ["brutal", "crt", "light", "latte", "honey", "vivid-light", "pastel-light", "confetti-light"];
const DARK = ["brutal-dark", "dark", "mocha", "dracula", "amoled", "contrast", "vivid-dark", "pastel-dark", "confetti-dark"];

function args(argv) {
  const out = { base: "http://localhost:3000", themes: "light,dark", only: null };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    if (!(key in out) || argv[i + 1] === undefined) throw new Error(`capture: unknown or empty option ${argv[i]}`);
    out[key] = argv[i + 1];
  }
  out.themes = out.themes === "all" ? [...LIGHT, ...DARK] : out.themes.split(",").map((t) => t.trim());
  for (const t of out.themes) if (!LIGHT.includes(t) && !DARK.includes(t)) throw new Error(`capture: unknown theme ${t}`);
  return out;
}

class Missing extends Error {}

/** The element for a help id, or a Missing error naming the step. */
async function find(page, id, where) {
  const el = page.locator(`[data-help-id="${id}"]`).first();
  try {
    await el.waitFor({ state: "attached", timeout: 5000 });
  } catch {
    throw new Missing(`capture: ${where}: data-help-id=${id} is not in the app`);
  }
  return el;
}

async function runStep(page, base, step, where) {
  if (step.go) await page.goto(new URL(step.go, base).href, { waitUntil: "networkidle" });
  if (step.click) await (await find(page, step.click, where)).click();
  if (step.type) await (await find(page, step.type.id, where)).fill(step.type.text);
  const ring = await find(page, step.ring, where);
  await ring.waitFor({ state: "visible", timeout: 10000 });
  const style = await page.addStyleTag({
    content: `[data-help-id="${step.ring}"]{outline:3px solid var(--accent) !important;outline-offset:2px}`,
  });
  await page.waitForTimeout(150); // let transitions settle before the picture
  return style;
}

async function capture(browser, opts, pageName, task, steps, theme) {
  const mode = DARK.includes(theme) ? "dark" : "light";
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: mode });
  // Same keys the app's boot script reads (THEME_KEY in theme.ts), set before any page script runs.
  await context.addInitScript(([m, t]) => {
    localStorage.setItem("thesis.mode", m);
    localStorage.setItem(`thesis.theme.${m}`, t);
  }, [mode, theme]);
  const page = await context.newPage();
  try {
    for (const step of steps) {
      const where = `${pageName}/${task} step ${step.step}`;
      const style = await runStep(page, opts.base, step, where);
      const dir = join(OUT, pageName, task);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${step.step}.${theme}.png`);
      await page.screenshot({ path: file });
      await style.evaluate((el) => el.remove());
      console.log(`capture: ${file}`);
    }
  } finally {
    await context.close();
  }
}

const opts = args(process.argv.slice(2));
const pages = Object.entries(SHOTS).filter(([name]) => !opts.only || name === opts.only);
if (pages.length === 0) {
  console.error(`capture: no page ${opts.only} in shots.json`);
  process.exit(1);
}
const browser = await chromium.launch();
let code = 0;
try {
  for (const [pageName, tasks] of pages)
    for (const [task, steps] of Object.entries(tasks))
      for (const theme of opts.themes) await capture(browser, opts, pageName, task, steps, theme);
} catch (error) {
  console.error(error instanceof Missing ? error.message : error);
  code = 1;
} finally {
  await browser.close();
}
process.exit(code);
