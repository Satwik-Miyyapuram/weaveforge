#!/usr/bin/env node
/**
 * Open the running app in a real, visible Chromium with CDP attached.
 *
 * The point is to watch and to drive the same session: a window on the screen
 * that a person can click in, and a debugging port that a script can attach to,
 * so what is checked by machine is what is being looked at by eye. It attaches
 * to whatever is already serving the app (`npm run dev`, port 3000 by default)
 * and pays for no build of its own.
 *
 *   node scripts/open-app.mjs                 # new window on http://localhost:3000
 *   node scripts/open-app.mjs http://localhost:3000/workspace --port 9334
 *
 * Killed with Ctrl-C, the browser is left open: it is the user's window, not
 * this script's. `--kill` closes a window this script opened earlier by port.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const portFlag = args.indexOf("--port");
const PORT = portFlag >= 0 ? Number(args[portFlag + 1]) : 9333;
const WIDTH = 1440;
const HEIGHT = 1000;

const profile = path.join(os.tmpdir(), `weaveforge-app-${PORT}`);

if (args.includes("--kill")) {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/close/${process.pid}`);
    console.log(response.ok ? "closed" : "nothing to close");
  } catch {
    console.log("nothing listening there");
  }
  process.exit(0);
}

// A previous run's profile cannot be opened twice: Chromium refuses and exits,
// which looks exactly like the port never coming up.
if (!fs.existsSync(profile)) fs.mkdirSync(profile, { recursive: true });

const child = spawn(
  chromium.executablePath(),
  [
    "--headless=false",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    // Not `--disable-gpu`: the ink editor picks its backend from what the
    // browser reports, and a window that shows the app must show the app's real
    // renderer, not a software fallback this script asked for.
    "--enable-unsafe-swiftshader",
    `--window-size=${WIDTH},${HEIGHT}`,
    "--window-position=60,40",
    url,
  ],
  { stdio: "ignore", detached: false },
);

/** Wait for the debugging endpoint, then report where it is and what it shows. */
async function debuggerUrl() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`the debugging port ${PORT} never answered`);
}

const endpoint = await debuggerUrl();
const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0] ?? (await browser.newContext());
const page = context.pages()[0] ?? (await context.newPage());

const response = await page
  .goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 })
  .catch((error) => {
    console.log(`the page did not load: ${String(error).split("\n")[0]}`);
    return null;
  });

console.log(`\napp window: ${page.url()}`);
console.log(`  http status: ${response ? response.status() : "no response"}`);
console.log(`  title: ${await page.title().catch(() => "?")}`);
console.log(`  cdp: http://127.0.0.1:${PORT} (user-data-dir ${profile})`);
console.log(
  `\nthe window is open and yours to use. Attach to it from another script with\n` +
    `  playwright.connectOverCDP("http://127.0.0.1:${PORT}")\n` +
    `leave this running to keep the browser alive; Ctrl-C here does not close it.\n`,
);

// Hold the process open so the browser stays attached and the port stays alive
// for whoever wants to drive it; Ctrl-C detaches without closing the window.
process.on("SIGINT", () => {
  console.log("detached; the window is still open");
  process.exit(0);
});
setInterval(() => {}, 1 << 30);
