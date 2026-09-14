#!/usr/bin/env node
/**
 * Run the desktop shell against a live dev server, with CDP attached.
 *
 * This is the loop this app is developed in: `next dev` serves the same source
 * the browser would get, the Electron shell loads it, and the window is on
 * screen where a person can use it while a script drives the same session over
 * CDP. A change under `apps/web` appears in the window on the next reload; a
 * change under `apps/desktop/src` needs this script run again (it rebundles the
 * main process first).
 *
 *   node scripts/dev-shell.mjs                       # dev server on :3000, CDP on :9222
 *   node scripts/dev-shell.mjs --url http://localhost:3001 --port 9223
 *   node scripts/dev-shell.mjs --keep-running        # do not close a running app
 *   node scripts/dev-shell.mjs --screenshot out.png
 *
 * Two things it has to get right, both learned the hard way:
 *
 *   - **The single-instance lock.** `main.ts` takes it, so a second shell does
 *     not open a second window: it focuses the first and exits, which looks
 *     exactly like the launch having failed. A stale copy of the app must be
 *     closed first, and closed *politely* — over CDP, the way its own window
 *     closes — not killed, so it writes its database and its preferences down.
 *   - **The dev server must already be up.** This script does not start one: a
 *     shell pointed at a port that answers nothing shows a blank window with a
 *     Chromium error page, and no amount of waiting fixes it.
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HERE, "..");

const args = process.argv.slice(2);
const value = (flag, fallback) => {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : fallback;
};
/** Flags this script reads itself; every other `--flag` goes to the shell. */
const KNOWN_FLAGS = new Set(["--keep-running", "--url", "--port", "--screenshot", "--help"]);
/** The ones of those that are switches rather than `--flag value` pairs. */
const BARE_FLAGS = new Set(["--keep-running", "--help"]);
const URL_TO_LOAD = value("--url", "http://localhost:3000/");
const PORT = Number(value("--port", 9222));
const SHOT = value("--screenshot", null);
const KEEP = args.includes("--keep-running");

/** Is anything listening on the debugging port, and what is it? */
async function inspect(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!response.ok) return null;
    const version = await response.json();
    return { browser: version.Browser, endpoint: version.webSocketDebuggerUrl };
  } catch {
    return null;
  }
}

/** Is the dev server answering? A shell pointed at nothing is a blank window. */
async function serverUp(url) {
  try {
    const response = await fetch(url, { redirect: "manual" });
    return response.status;
  } catch {
    return null;
  }
}

const status = await serverUp(URL_TO_LOAD);
if (status === null) {
  console.error(
    `nothing answered at ${URL_TO_LOAD} — start the dev server first:\n  npm run dev`,
  );
  process.exit(1);
}
console.log(`dev server: ${URL_TO_LOAD} → HTTP ${status}`);

const running = await inspect(PORT);
if (running && !KEEP) {
  console.log(`closing the app already on :${PORT} (${running.browser})…`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  for (const page of browser.contexts().flatMap((context) => context.pages())) {
    await page.evaluate(() => window.close()).catch(() => undefined);
  }
  // Wait for the lock to be released rather than sleeping a guessed interval.
  for (let i = 0; i < 60; i += 1) {
    if (!(await inspect(PORT))) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await browser.close().catch(() => undefined);
  console.log(`  :${PORT} is ${(await inspect(PORT)) ? "still up" : "free"}`);
}

console.log("bundling the main process…");
const build = spawnSync("npm", ["run", "build"], {
  cwd: DESKTOP,
  stdio: "inherit",
  shell: true,
});
if (build.status !== 0) process.exit(build.status ?? 1);

/**
 * The arguments the shell itself gets: every `--flag` this script does not
 * read, and not the values of the ones it does. The flags that matter are the
 * ones a particular machine needs (`--in-process-gpu`, `--disable-gpu`) and this
 * script cannot guess them.
 */
const forwarded = [];
for (let i = 0; i < args.length; i += 1) {
  if (!args[i].startsWith("--")) continue;
  if (!KNOWN_FLAGS.has(args[i])) forwarded.push(args[i]);
  // A flag this script reads takes its value with it — unless it is a bare
  // switch, which has none to skip.
  else if (!BARE_FLAGS.has(args[i])) i += 1;
}

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["electron", ".", `--remote-debugging-port=${PORT}`, ...forwarded],
  {
    cwd: DESKTOP,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, WEAVEFORGE_URL: URL_TO_LOAD },
  },
);

/** Wait for the debugging endpoint, then say what the window is showing. */
async function endpoint() {
  for (let i = 0; i < 200; i += 1) {
    const info = await inspect(PORT);
    if (info) return info.endpoint;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`the debugging port ${PORT} never answered`);
}

const webSocket = await endpoint();
const browser = await chromium.connectOverCDP(webSocket);
const context = browser.contexts()[0] ?? (await browser.newContext());
let page = context.pages()[0];
for (let i = 0; i < 100 && !page; i += 1) {
  await new Promise((r) => setTimeout(r, 200));
  page = context.pages()[0];
}
if (!page) throw new Error("the shell opened no window");

await page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => undefined);
await page
  .waitForFunction(() => document.body.innerText.trim().length > 0, null, { timeout: 60_000 })
  .catch(() => undefined);

console.log(`\napp window: ${page.url()}`);
console.log(`  title:  ${await page.title().catch(() => "?")}`);
console.log(`  cdp:    http://127.0.0.1:${PORT}`);
if (SHOT) {
  await page.screenshot({ path: SHOT });
  console.log(`  shot:   ${SHOT}`);
}
console.log(
  `\nthe window is open and yours to use; a change under apps/web shows up on reload.\n`,
);

// Ctrl-C stops watching; the app stays open, because it is the user's window.
process.on("SIGINT", () => {
  console.log("detached; the app is still open");
  process.exit(0);
});
child.on("exit", (code) => {
  console.log(`the app exited (${code})`);
  process.exit(code ?? 0);
});
setInterval(() => {}, 1 << 30);
