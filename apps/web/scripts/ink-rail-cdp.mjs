/**
 * The ink rail's page boundaries, driven over CDP in a real browser.
 *
 * Same harness as `ink-image-cdp.mjs` (`e2e/fixtures/ink-harness.tsx`), served
 * on a page of its own and driven with real pointer events. The pane is made
 * shorter than a page so a boundary is always on screen.
 *
 * What it proves:
 *   1. A stroke that starts on page 2's visible top, while page 1 is live,
 *      flips to page 2 first and lands in page 2's chunk — not page 1's, and
 *      not nowhere (which is what a pen-down on inert static ink did: the
 *      browser read it as a scroll).
 *   2. The flip did not scroll the rail — the pen is where the page already is.
 *   3. The reverse: scrolled to page 3, a stroke on page 2's visible bottom
 *      lands on page 2.
 *   4. The rail's window: after a flip 2→3, slots 2 and 3 keep their DOM
 *      nodes, slot 1 drops to a ghost (it has no ink) and slot 4 is loaded.
 *   5. The native scrollbar takes no layout width: `clientWidth` of the
 *      scroller equals its `offsetWidth`, with and without overflow.
 *
 * Run: node scripts/ink-rail-cdp.mjs [--headed] [--keep]
 * Screenshots land in `local-dev/ink-rail-cdp/`.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SHOTS = path.resolve(ROOT, "..", "local-dev", "ink-rail-cdp");
const HEADED = process.argv.includes("--headed");

/* ------------------------------------------------------------------ bundling */

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "weaveforge-ink-rail-"));
fs.mkdirSync(path.join(outDir, "worker"), { recursive: true });

await build({
  entryPoints: [path.join(ROOT, "e2e/fixtures/ink-harness.tsx")],
  bundle: true,
  outfile: path.join(outDir, "bundle.js"),
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
  outfile: path.join(outDir, "worker", "ink-worker.ts"),
  format: "iife",
  platform: "browser",
  target: "es2022",
  logLevel: "warning",
});

// A pane shorter than a page: 900 wide fits an A4 sheet ~1240 tall, so a
// 700 px pane always has a boundary within one page of scroll.
fs.writeFileSync(
  path.join(outDir, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>ink rail</title>` +
    `<link rel="stylesheet" href="/bundle.css">` +
    `<style>html,body{margin:0;background:#f4f4f5}` +
    `#ink{width:900px;height:700px;margin:0 auto}</style>` +
    `<div id="ink"></div><script type="module" src="/bundle.js"></script>`,
);

/* -------------------------------------------------------------------- serving */

const server = createServer((req, res) => {
  const name = (req.url ?? "/").split("?")[0];
  if (name === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
  const file =
    name === "/" ? path.join(outDir, "index.html") : path.join(outDir, name);
  if (!file.startsWith(outDir) || !fs.existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
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

/* ------------------------------------------------------------------- browser */

const PORT = 9533 + (process.pid % 200);
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
    "--window-size=1000,760",
    "about:blank",
  ],
  { stdio: "ignore" },
);

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

const endpoint = await debuggerUrl();
const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0] ?? (await browser.newContext());
const page = context.pages()[0] ?? (await context.newPage());
await page.setViewportSize({ width: 1000, height: 760 });

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

fs.mkdirSync(SHOTS, { recursive: true });
let shot = 0;
async function snap(label) {
  shot += 1;
  const file = path.join(SHOTS, `${String(shot).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file });
  console.log(`   screenshot → ${path.relative(ROOT, file)}`);
  return file;
}

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

/* ---------------------------------------------------------------------- boot */

await page.goto(origin);
await page.waitForFunction(() => Boolean(window.inkHarness), null, {
  timeout: 20_000,
});
await page
  .waitForFunction(
    () => {
      const b = document.querySelector(".ink-readout")?.getAttribute("data-backend");
      return b && b !== "starting";
    },
    null,
    { timeout: 15_000 },
  )
  .catch(() => {});
const backend = await page
  .locator(".ink-readout")
  .first()
  .getAttribute("data-backend")
  .catch(() => null);
console.log(`\n=== ink rail up on ${origin} (backend: ${backend ?? "?"}) ===\n`);

/** The rail as the DOM has it. */
const rail = () =>
  page.evaluate(() => {
    const scroller = document.querySelector(".ink-page-scroll");
    const slots = [...scroller.querySelectorAll(":scope > .ink-page")].map((el) => ({
      page: el.getAttribute("data-page"),
      ghost: el.getAttribute("data-ghost"),
      left: Math.round(el.getBoundingClientRect().left),
      top: Math.round(el.getBoundingClientRect().top),
      bottom: Math.round(el.getBoundingClientRect().bottom),
    }));
    const liveSheetBox = document
      .querySelector(".ink-live-layer .ink-sheet")
      .getBoundingClientRect();
    const liveSheet = { left: Math.round(liveSheetBox.left), top: Math.round(liveSheetBox.top) };
    const canvas = document.querySelector(".ink-canvas");
    const box = canvas.getBoundingClientRect();
    const sbox = scroller.getBoundingClientRect();
    const readout = document.querySelector(".ink-readout");
    return {
      scrollTop: scroller.scrollTop,
      clientWidth: scroller.clientWidth,
      offsetWidth: scroller.offsetWidth,
      scrollerTop: Math.round(sbox.top),
      scrollerBottom: Math.round(sbox.bottom),
      canvas: {
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        left: Math.round(box.left),
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
      live: document.querySelector(".ink-live-layer .ink-page")?.getAttribute("data-page"),
      liveSheet,
      pageLabel: readout?.textContent ?? "",
      slots,
    };
  });

/** Draw a short mouse stroke from (x, y). */
async function stroke(x, y, dx = 160, dy = 20) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(x + (dx * i) / 12, y + (dy * i) / 12, { steps: 2 });
  }
  await page.mouse.up();
  // The chunk write is debounced (INK_SAVE_DELAY_MS); wait it out, then quiet.
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.inkHarness.settled());
}

/** The pointer target at a client point. */
const targetAt = (x, y) =>
  page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return el ? `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}` : null;
    },
    [x, y],
  );

/* ----------------------------------------------------- 0. four pages to work with */

console.log("0. Four pages");
const addPage = page.getByRole("button", { name: "Add new page" });
for (let i = 0; i < 3; i += 1) {
  await addPage.click();
  await page.waitForTimeout(150);
}
await page.evaluate(() => window.inkHarness.settled());
let r = await rail();
check("four slots in the rail", r.slots.length === 4, JSON.stringify(r.slots));
// Back to the top: adding a page scrolls to it.
for (let i = 0; i < 3; i += 1) {
  await page.getByRole("button", { name: "Previous page" }).click();
  await page.waitForTimeout(700);
}
await page.waitForTimeout(800);
r = await rail();
check("page 1 is live", r.live === "0", `live=${r.live}`);

/* ------------------------------------------------- 1. canvas covers the pane */

console.log("\n1. The canvas covers the whole pane");
// At scrollTop 0 the dock sits at the top of the scroller's content box, i.e.
// below its 18 px padding; once scrolled it sticks to the scrollport edge. So
// the canvas is the pane's height, and starts within the padding.
check(
  "canvas is the pane's height, docked at the top",
  Math.abs(r.canvas.height - (r.scrollerBottom - r.scrollerTop)) <= 1 &&
    r.canvas.top - r.scrollerTop >= 0 &&
    r.canvas.top - r.scrollerTop <= 18,
  `canvas ${r.canvas.top}..${r.canvas.bottom}, scroller ${r.scrollerTop}..${r.scrollerBottom}`,
);
check(
  "the live sheet sits over its slot",
  r.liveSheet.left === r.slots[0].left && r.liveSheet.top === r.slots[0].top,
  `live ${JSON.stringify(r.liveSheet)}, slot ${JSON.stringify(r.slots[0])}`,
);
check(
  "native scrollbar takes no layout width",
  r.clientWidth === r.offsetWidth,
  `clientWidth ${r.clientWidth}, offsetWidth ${r.offsetWidth}`,
);

/* ----------------------------------------- 2. pen-down on page 2 while page 1 live */

console.log("\n2. Scroll so page 2's top is visible, draw on it while page 1 is live");
// Scroll until page 2's top is in the lower part of the pane, but page 1 is
// still the nearer to the centre.
await page.evaluate(() => {
  const scroller = document.querySelector(".ink-page-scroll");
  const slot = scroller.querySelector(':scope > .ink-page[data-page="1"], :scope > .ink-page[data-ghost="1"]');
  scroller.scrollTop = slot.offsetTop - scroller.clientHeight * 0.7;
});
await page.waitForTimeout(400);
r = await rail();
check("page 1 still live after the scroll", r.live === "0", `live=${r.live}`);
check(
  "once scrolled, the canvas hugs the scrollport",
  Math.abs(r.canvas.top - r.scrollerTop) <= 1 &&
    Math.abs(r.canvas.bottom - r.scrollerBottom) <= 1,
  `canvas ${r.canvas.top}..${r.canvas.bottom}, scroller ${r.scrollerTop}..${r.scrollerBottom}`,
);
const slot2 = r.slots.find((s) => s.page === "1" || s.ghost === "1");
check("page 2's top is on screen", slot2 && slot2.top < r.scrollerBottom - 100, JSON.stringify(slot2));
const x = r.canvas.left + r.canvas.width / 2 - 100;
const y2 = slot2.top + 60;
const target = await targetAt(x, y2);
check("the pointer target over page 2 is the canvas", target === "canvas.ink-canvas", target ?? "null");
await snap("before-boundary-stroke");
const scrollBefore = r.scrollTop;
await stroke(x, y2);
await snap("after-boundary-stroke");
r = await rail();
const counts = await page.evaluate(async () => [
  await window.inkHarness.strokeCount(0),
  await window.inkHarness.strokeCount(1),
  await window.inkHarness.strokeCount(2),
  await window.inkHarness.strokeCount(3),
]);
check("the stroke flipped the live page to 2", r.live === "1", `live=${r.live}`);
check("the stroke is in page 2's chunk", counts[1] === 1, `counts ${JSON.stringify(counts)}`);
check("page 1's chunk has no stroke", !counts[0], `counts ${JSON.stringify(counts)}`);
check("the flip did not scroll the rail", Math.abs(r.scrollTop - scrollBefore) < 2, `${scrollBefore} → ${r.scrollTop}`);

/* --------------------------------------------- 2b. a stroke that crosses the edge */

console.log("\n2b. A stroke that runs off page 1 onto page 2 is split at the edge");
// Back to page 1: pen down on its visible bottom, drag down across the gap
// into page 2. One gesture, two strokes, one per page — nothing stored past
// a page's edge.
r = await rail();
const slotX1 = r.slots.find((s) => s.page === "0");
const slotX2 = r.slots.find((s) => s.page === "1");
const before2b = await page.evaluate(async () => [
  await window.inkHarness.strokeCount(0),
  await window.inkHarness.strokeCount(1),
]);
await stroke(x, slotX1.bottom - 40, 60, slotX2.top + 80 - (slotX1.bottom - 40));
r = await rail();
const after2b = await page.evaluate(async () => [
  await window.inkHarness.strokeCount(0),
  await window.inkHarness.strokeCount(1),
]);
check("the crossing stroke ends with page 2 live", r.live === "1", `live=${r.live}`);
check("page 1 got the part before the edge", after2b[0] === (before2b[0] ?? 0) + 1, `${JSON.stringify(before2b)} → ${JSON.stringify(after2b)}`);
check("page 2 got the part after the edge", after2b[1] === (before2b[1] ?? 0) + 1, `${JSON.stringify(before2b)} → ${JSON.stringify(after2b)}`);
const maxY2b = await page.evaluate(() => window.inkHarness.maxY(0));
check("nothing on page 1 is stored past its edge", maxY2b !== null && maxY2b <= 2970, `maxY=${maxY2b}`);
await snap("after-crossing-stroke");

/* ------------------------------------------------ 3. reverse: page 3 live, draw on 2 */

console.log("\n3. Page 3 live, draw on page 2's visible bottom");
await page.getByRole("button", { name: "Next page" }).click();
await page.waitForTimeout(900);
r = await rail();
check("page 3 is live", r.live === "2", `live=${r.live}`);
await page.evaluate(() => {
  const scroller = document.querySelector(".ink-page-scroll");
  const slot = scroller.querySelector(':scope > .ink-page[data-page="2"]');
  // Page 3's top a third of the way down: page 2's bottom is above it.
  scroller.scrollTop = slot.offsetTop - scroller.clientHeight * 0.35;
});
await page.waitForTimeout(400);
r = await rail();
check("page 3 still live", r.live === "2", `live=${r.live}`);
const slot2b = r.slots.find((s) => s.page === "1");
const y2b = slot2b.bottom - 60;
await stroke(x, y2b);
r = await rail();
const counts3 = await page.evaluate(async () => [
  await window.inkHarness.strokeCount(0),
  await window.inkHarness.strokeCount(1),
  await window.inkHarness.strokeCount(2),
  await window.inkHarness.strokeCount(3),
]);
check("the stroke flipped back to page 2", r.live === "1", `live=${r.live}`);
check("page 2 now holds three strokes", counts3[1] === 3, `counts ${JSON.stringify(counts3)}`);
check("page 3 has none", !counts3[2], `counts ${JSON.stringify(counts3)}`);
await snap("after-reverse-stroke");

/* ---------------------------------------------------------- 4. the window */

console.log("\n4. The window keeps what is on screen");
// Page 2 live: slots 1..3 static, 4 a ghost (it is empty).
r = await rail();
const kinds = r.slots.map((s) => (s.page !== null ? "static" : "ghost"));
check("page 2 live: 1,2,3 static, 4 ghost", kinds.join(",") === "static,static,static,ghost", kinds.join(","));
// Tag the DOM nodes of slots 2 and 3, flip to 3, and see they survived.
await page.evaluate(() => {
  const scroller = document.querySelector(".ink-page-scroll");
  scroller.querySelector(':scope > .ink-page[data-page="1"]').dataset.tag = "two";
  scroller.querySelector(':scope > .ink-page[data-page="2"]').dataset.tag = "three";
});
await page.getByRole("button", { name: "Next page" }).click();
await page.waitForTimeout(900);
r = await rail();
const kept = await page.evaluate(() => {
  const scroller = document.querySelector(".ink-page-scroll");
  return [
    scroller.querySelector(':scope > .ink-page[data-page="1"]')?.dataset.tag,
    scroller.querySelector(':scope > .ink-page[data-page="2"]')?.dataset.tag,
  ];
});
const kinds3 = r.slots.map((s) => (s.page !== null ? "static" : "ghost"));
check("page 3 live", r.live === "2", `live=${r.live}`);
check("slots 2 and 3 kept their DOM across the flip", kept[0] === "two" && kept[1] === "three", JSON.stringify(kept));
check("page 3 live: 1,2,3,4 all static (page 1 has ink since 2b)", kinds3.join(",") === "static,static,static,static", kinds3.join(","));

/* ------------------------------------------ 4b. a page just left keeps its ink */

console.log("\n4b. Ink drawn on a page shows in its static slot once it is left");
// Page 3 is live. Draw on it, then pen-down on page 4's visible part.
await page.evaluate(() => {
  const scroller = document.querySelector(".ink-page-scroll");
  const slot = scroller.querySelector(':scope > .ink-page[data-page="3"]');
  scroller.scrollTop = slot.offsetTop - scroller.clientHeight * 0.6;
});
await page.waitForTimeout(400);
r = await rail();
check("page 3 still live", r.live === "2", `live=${r.live}`);
const slot3 = r.slots.find((s) => s.page === "2");
await stroke(x, slot3.bottom - 80);
const slot4 = (await rail()).slots.find((s) => s.page === "3");
// No wait after the flip: the slot must catch up on its own.
await page.mouse.move(x, slot4.top + 40);
await page.mouse.down();
await page.mouse.move(x + 60, slot4.top + 50, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(400);
const slot3Paths = await page.evaluate(() =>
  document.querySelector('.ink-page-scroll > .ink-page[data-page="2"] svg path') !== null,
);
r = await rail();
check("page 4 is live", r.live === "3", `live=${r.live}`);
check("page 3's static slot shows the stroke just drawn on it", slot3Paths);

/* ----------------------------------- 4c. a save in flight survives an unmount */

console.log("\n4c. A stroke drawn right before the host unmounts is saved");
await page.waitForTimeout(1500);
await page.evaluate(() => window.inkHarness.settled());
const before4 = await page.evaluate(() => window.inkHarness.strokeCount(3));
await page.mouse.move(x, slot4.top + 120);
await page.mouse.down();
await page.mouse.move(x + 120, slot4.top + 140, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(50);
await page.evaluate(() => window.inkHarness.remount());
await page.waitForTimeout(1500);
await page.evaluate(() => window.inkHarness.settled());
const after4 = await page.evaluate(() => window.inkHarness.strokeCount(3));
check("the stroke drawn 50 ms before the unmount is in the chunk", after4 === (before4 ?? 0) + 1, `${before4} → ${after4}`);
const remounted = await page.evaluate(() => {
  const el = document.querySelector(".ink-readout");
  return el?.textContent ?? "";
});
check("the new host came up", /strokes/.test(remounted), remounted);
await page.waitForFunction(
  () => document.querySelector(".ink-live-layer .ink-canvas") !== null,
  null,
  { timeout: 10_000 },
);

/* ------------------------------------------------------- 5. overlay scrollbar */

console.log("\n5. Overlay scrollbar");
const bar = await page.evaluate(() => {
  const track = document.querySelector(".ink-rail-container .overlay-scrollbar-track");
  const thumb = track?.querySelector(".overlay-scrollbar-thumb");
  const scroller = document.querySelector(".ink-page-scroll");
  return {
    present: Boolean(track),
    visible: track?.classList.contains("is-visible") ?? false,
    thumbOpacity: thumb ? getComputedStyle(thumb).opacity : null,
    overflow: scroller.scrollHeight > scroller.clientHeight,
    nativeWidth: scroller.offsetWidth - scroller.clientWidth,
  };
});
check("overlay track rendered when the rail overflows", bar.present && bar.overflow, JSON.stringify(bar));
check("native scrollbar reserves 0 px", bar.nativeWidth === 0, `${bar.nativeWidth}px`);
await page.mouse.move(x, r.scrollerTop + 200);
await page.mouse.wheel(0, 120);
await page.waitForTimeout(100);
const shown = await page.evaluate(() =>
  document.querySelector(".ink-rail-container .overlay-scrollbar-track")?.classList.contains("is-visible"),
);
check("thumb shows on scroll", shown === true);
await page.waitForTimeout(1600);
const hidden = await page.evaluate(() =>
  document.querySelector(".ink-rail-container .overlay-scrollbar-track")?.classList.contains("is-visible"),
);
check("thumb hides after idle", hidden === false);

/* -------------------------------------------------------------------- report */

const harness = await page.evaluate(() => ({
  worker: window.inkHarness.worker(),
  problems: window.inkHarness.problems(),
}));
console.log("\n=== the page's own account of itself ===");
console.log(
  `  worker: created ${harness.worker.created}, ${harness.worker.messages} messages, ${harness.worker.errors} errors`,
);
console.log(
  harness.problems.length === 0
    ? "  nothing reported broken"
    : harness.problems.map((p) => `  ${p}`).join("\n"),
);
console.log("\n=== console/page errors ===");
console.log(problems.length === 0 ? "  none" : problems.map((p) => `  ${p}`).join("\n"));

const failed = results.filter((f) => !f.ok);
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
