/**
 * The ink editor on a page of its own, driven over CDP: what the two ink CDP
 * scripts (`ink-image-cdp.mjs`, `ink-rail-cdp.mjs`) share.
 *
 * The app itself needs a database and a session to reach an ink note, and the
 * ink editor is a component with a `deps` surface — so this bundles the harness
 * page (`e2e/fixtures/ink-harness.tsx`) with esbuild, serves it over
 * `http://127.0.0.1`, launches Chromium with a debugging port and attaches to
 * it through Playwright's CDP client. The script gets back the page, a
 * screenshot helper, a `check` that tallies results, and the tear-down.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * @param {object} options
 * @param {string} options.name  Names the screenshot folder and the temp dir.
 * @param {string} options.title  The harness page's title.
 * @param {number} options.paneHeight  The `#ink` pane's height in CSS px.
 * @param {number} options.port  The base debugging port (offset by pid).
 * @param {number} options.viewportHeight
 */
export async function startInkHarness({ name, title, paneHeight, port, viewportHeight }) {
  const SHOTS = path.resolve(ROOT, "..", "local-dev", name);
  const HEADED = process.argv.includes("--headed");

  /* ---------------------------------------------------------------- bundling */

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `weaveforge-${name}-`));
  fs.mkdirSync(path.join(outDir, "worker"), { recursive: true });

  await build({
    entryPoints: [path.join(ROOT, "e2e/fixtures/ink-harness.tsx")],
    bundle: true,
    outfile: path.join(outDir, "bundle.js"),
    // ESM, not IIFE: the host builds its worker from
    // `new URL("../worker/ink-worker.ts", import.meta.url)`, which only resolves
    // against a real module URL.
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    alias: { "@": path.join(ROOT, "src") },
    loader: { ".css": "css" },
    logLevel: "warning",
  });

  await build({
    entryPoints: [path.join(ROOT, "src/features/ink/worker/ink-worker.ts")],
    bundle: true,
    // Named exactly as the host asks for it, and a classic worker because that is
    // how the host constructs it.
    outfile: path.join(outDir, "worker", "ink-worker.ts"),
    format: "iife",
    platform: "browser",
    target: "es2022",
    logLevel: "warning",
  });

  fs.writeFileSync(
    path.join(outDir, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
      `<link rel="stylesheet" href="/bundle.css">` +
      `<style>html,body{margin:0;background:#f4f4f5}` +
      `#ink{width:900px;height:${paneHeight}px;margin:0 auto}</style>` +
      `<div id="ink"></div><script type="module" src="/bundle.js"></script>`,
  );

  /* ------------------------------------------------------------------ serving */

  const server = createServer((req, res) => {
    const name_ = (req.url ?? "/").split("?")[0];
    if (name_ === "/favicon.ico") {
      // Chrome asks for one anyway; a 404 here is noise in the console report.
      res.writeHead(204);
      res.end();
      return;
    }
    const file = name_ === "/" ? path.join(outDir, "index.html") : path.join(outDir, name_);
    if (!file.startsWith(outDir) || !fs.existsSync(file)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    // Typed by what the file is, not by the URL: `/` is the HTML, and the worker
    // is served from a path ending in `.ts` even though it is plain JavaScript by
    // then.
    res.writeHead(200, {
      "Content-Type": file.endsWith(".html")
        ? "text/html"
        : file.endsWith(".css")
          ? "text/css"
          : "text/javascript",
    });
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  /* ------------------------------------------------------------------ browser */

  const PORT = port + (process.pid % 200);
  const chrome = spawn(
    chromium.executablePath(),
    [
      HEADED ? "--headless=false" : "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${path.join(outDir, "profile")}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--enable-unsafe-swiftshader",
      `--window-size=1000,${viewportHeight}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  /** Wait for the debugging endpoint, then attach over CDP. */
  async function debuggerUrl() {
    for (let i = 0; i < 100; i += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
        if (response.ok) return (await response.json()).webSocketDebuggerUrl;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Chromium never opened its debugging port");
  }

  const browser = await chromium.connectOverCDP(await debuggerUrl());
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  await page.setViewportSize({ width: 1000, height: viewportHeight });

  const problems = [];
  page.on("pageerror", (error) => {
    problems.push(`pageerror: ${error.message}`);
    console.log(`  [pageerror] ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    problems.push(`console: ${message.text()}`);
    console.log(`  [console] ${message.text().slice(0, 300)}`);
  });
  page.on("requestfailed", (request) => {
    console.log(`  [requestfailed] ${request.url()} ${request.failure()?.errorText}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) console.log(`  [http ${response.status()}] ${response.url()}`);
  });

  fs.mkdirSync(SHOTS, { recursive: true });
  let shot = 0;
  async function snap(label) {
    shot += 1;
    const file = path.join(SHOTS, `${String(shot).padStart(2, "0")}-${label}.png`);
    await page.screenshot({ path: file });
    console.log(`   screenshot → ${path.relative(ROOT, file)}`);
    return file;
  }

  /**
   * Put everything down. Windows keeps a handle on the browser profile for a
   * moment after the process is killed, so a failed delete is a retry rather
   * than a crash at the end of an otherwise passing run.
   */
  async function cleanUp() {
    await browser.close().catch(() => undefined);
    chrome.kill();
    server.close();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.rmSync(outDir, { recursive: true, force: true });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  }

  const results = [];
  function check(label, ok, detail = "") {
    results.push({ label, ok });
    console.log(` ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  }

  /**
   * The page's own account of itself and the tally, then the tear-down (or,
   * with `--keep`, the addresses to poke at). Exits with the tally.
   */
  async function finish(extraReport = "") {
    const harness = await page.evaluate(() => ({
      worker: window.inkHarness.worker(),
      problems: window.inkHarness.problems(),
    }));
    console.log("\n=== the page's own account of itself ===");
    if (extraReport) console.log(extraReport);
    console.log(
      `  worker: created ${harness.worker.created}, ${harness.worker.messages} messages, ` +
        `${harness.worker.errors} errors${harness.worker.url ? ` (${harness.worker.url})` : ""}`,
    );
    console.log(
      harness.problems.length === 0
        ? "  nothing reported broken"
        : harness.problems.map((p) => `  ${p}`).join("\n"),
    );
    console.log("\n=== console/page errors ===");
    console.log(problems.length === 0 ? "  none" : problems.map((p) => `  ${p}`).join("\n"));

    const failed = results.filter((r) => !r.ok);
    console.log(
      `\n${results.length - failed.length}/${results.length} checks passed` +
        (failed.length ? ` — failed: ${failed.map((f) => f.label).join("; ")}` : ""),
    );
    if (!process.argv.includes("--keep")) {
      await cleanUp();
    } else {
      console.log(`\nkept: browser on :${PORT}, server on ${origin}, bundles in ${outDir}`);
    }
    process.exit(failed.length === 0 ? 0 : 1);
  }

  return { ROOT, page, origin, problems, results, snap, check, cleanUp, finish };
}
