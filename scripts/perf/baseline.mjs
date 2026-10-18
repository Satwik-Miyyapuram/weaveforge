// Speed baseline against WeaveForge Dev (CDP 9223). Usage: node scripts/perf/baseline.mjs [out-dir]. See docs/plans/speed-plan.md.
import { mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { send, run, shot, close } from "./cdp.mjs";

const PAPER = process.env.PERF_PAPER ?? "e7b08520-e2e6-4dfc-b903-bc431b14c858";
const OUT = process.argv[2] ?? ".";
mkdirSync(OUT, { recursive: true });
const NOTE_TITLE = process.env.PERF_NOTE ?? "Perf dense ink";
const NAV = ["/dashboard/", "/workspace/", "/papers/", "/notes/", "/graph/", "/lists/", "/experiments/", "/git/"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { at: new Date().toISOString(), phases: {} };

await send("Performance.enable");

function rss() {
  const ps = `$p = Get-Process | ? { $_.Path -like "$env:LOCALAPPDATA\\Programs\\WeaveForge Dev\\*" }; @{ n = $p.Count; ws = ($p | Measure-Object WorkingSet64 -Sum).Sum; priv = ($p | Measure-Object PrivateMemorySize64 -Sum).Sum } | ConvertTo-Json -Compress`;
  const r = JSON.parse(execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`).toString());
  return { procs: r.n, workingSetMB: +(r.ws / 2 ** 20).toFixed(1), privateMB: +(r.priv / 2 ** 20).toFixed(1) };
}
async function mem(label) {
  await send("HeapProfiler.collectGarbage").catch(() => {});
  const m = (await send("Performance.getMetrics")).result.metrics;
  const g = (k) => m.find((x) => x.name === k)?.value ?? 0;
  return { label, jsHeapUsedMB: +(g("JSHeapUsedSize") / 2 ** 20).toFixed(1), domNodes: g("Nodes"), ...rss() };
}
async function goto(path) {
  await run(`location.href = "app://weaveforge${path}"; 1`).catch(() => {});
  await sleep(5000);
}
// Observers live in the page; a full reload drops them, so each phase reinstalls.
const OBSERVE = String.raw`(() => {
  window.__loaf = []; window.__ev = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__loaf.push({ start: e.startTime, dur: e.duration, block: e.blockingDuration,
    scripts: e.scripts.slice(0, 3).map((s) => ({ dur: Math.round(s.duration), src: (s.sourceURL || "").split("/").pop() + ":" + (s.sourceFunctionName || "") + ":" + s.invoker })) }); })
    .observe({ type: "long-animation-frame", buffered: false });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__ev.push({ name: e.name, start: e.startTime, dur: e.duration,
    delay: e.processingStart - e.startTime, proc: e.processingEnd - e.processingStart }); })
    .observe({ type: "event", durationThreshold: 16, buffered: false });
  return performance.now();
})()`;
async function click(selectorJs) {
  const r = await run(`(() => { const el = ${selectorJs}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  if (!r) throw new Error("no element: " + selectorJs);
  await sleep(150);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
    await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
}
async function collect(t0) {
  return run(`JSON.stringify({ measures: performance.getEntriesByType("measure").filter((m) => m.startTime >= ${t0}).map((m) => ({ name: m.name, dur: m.duration, detail: m.detail })),
    loaf: window.__loaf, events: window.__ev })`).then(JSON.parse);
}
const SCROLLER = String.raw`[...document.querySelectorAll("*")].filter((e) => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight - e.clientHeight > 200).sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0]`;
async function scrollToEnd(sel, step = 600, gap = 120) {
  const t = Date.now();
  for (let i = 0; i < 400; i++) {
    const done = await run(`(() => { const s = ${sel}; s.scrollTop += ${step}; return s.scrollTop + s.clientHeight >= s.scrollHeight - 2; })()`);
    await sleep(gap);
    if (done) break;
  }
  return Date.now() - t;
}

// Flag on, reload so perf-marks reads it.
await run(`localStorage.setItem("wf:perf", "1"); 1`);
await goto("/dashboard/");
await sleep(5000);
out.idle = await mem("idle dashboard");

// Tab switches: trusted clicks on the sidebar, two rounds.
{
  const t0 = await run(OBSERVE);
  for (let round = 0; round < 2; round++)
    for (const href of NAV.slice(1).concat(NAV[0])) {
      await click(`document.querySelector('a[href="${href}"]')`);
      await sleep(2500);
    }
  out.phases.nav = await collect(t0);
  out.afterNav = await mem("after 2 nav rounds");
}

// PDF: open the 40-page paper and scroll end to end.
{
  await goto(`/papers/?paper=${PAPER}`);
  const t0 = await run(OBSERVE);
  await click(`[...document.querySelectorAll("button,a")].find((b) => b.innerText.trim() === "PDF")`);
  await sleep(6000);
  out.pdfOpen = await mem("pdf open");
  const ms = await scrollToEnd(`document.querySelector(".pdf-reader-scroll")`);
  await sleep(4000);
  out.pdfEnd = await mem("pdf scrolled to end");
  out.pdfEnd.scrollMs = ms;
  out.pdfEnd.canvases = await run(`document.querySelectorAll(".pdf-reader-scroll canvas").length`);
  out.pdfEnd.canvasMB = await run(`+([...document.querySelectorAll(".pdf-reader-scroll canvas")].reduce((a, c) => a + c.width * c.height * 4, 0) / 2 ** 20).toFixed(1)`);
  out.phases.pdf = await collect(t0);
  await shot(`${OUT}/baseline-pdf.png`);
}

// Ink: open the 50-page dense note (Read mode) and scroll end to end.
{
  await goto("/notes/");
  const t0 = await run(OBSERVE);
  await click(`[...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && e.textContent.trim() === "${NOTE_TITLE}").at(-1)`);
  await sleep(10000);
  out.inkOpen = await mem("ink note open");
  const ms = await scrollToEnd(SCROLLER, 800);
  await sleep(3000);
  out.inkEnd = await mem("ink note scrolled to end");
  out.inkEnd.scrollMs = ms;
  out.inkEnd.svgPaths = await run(`document.querySelectorAll("svg path").length`);
  out.phases.ink = await collect(t0);
  await shot(`${OUT}/baseline-ink.png`);
}

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
const stats = (xs) => { const a = [...xs].sort((x, y) => x - y); const r = (v) => +v.toFixed(1);
  return { n: a.length, p50: r(pct(a, 50)), p95: r(pct(a, 95)), max: r(a.at(-1)), sum: r(a.reduce((s, x) => s + x, 0)) }; };
out.summary = {};
for (const [ph, d] of Object.entries(out.phases)) {
  const by = {};
  for (const m of d.measures) (by[m.name.startsWith("nav:") ? "nav:*" : m.name] ??= []).push(m.dur);
  const s = {};
  for (const [k, v] of Object.entries(by)) s[k] = stats(v);
  if (d.loaf.length) s["loaf"] = stats(d.loaf.map((l) => l.dur));
  if (d.loaf.length) s["loaf.blocking"] = stats(d.loaf.map((l) => l.block));
  if (d.events.length) s["event(INP-ish)"] = stats(d.events.map((e) => e.dur));
  s.loafOver50 = d.loaf.filter((l) => l.dur > 50).length;
  s.worstLoaf = [...d.loaf].sort((a, b) => b.dur - a.dur).slice(0, 3);
  out.summary[ph] = s;
}
out.navEach = out.phases.nav.measures.filter((m) => m.name.startsWith("nav:")).map((m) => `${m.name} ${m.dur.toFixed(1)}`);
writeFileSync(`${OUT}/baseline.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ summary: out.summary, navEach: out.navEach, mem: [out.idle, out.afterNav, out.pdfOpen, out.pdfEnd, out.inkOpen, out.inkEnd] }, null, 1));
close();
