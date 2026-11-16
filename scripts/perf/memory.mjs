// Memory by part for WeaveForge Dev (CDP 9223), read-only. Usage: node scripts/perf/memory.mjs [--json] [--dump]
// Prints the page's JS heap, wasm linear memory, DOM, canvases (attached and detached), images, workers
// (PDF.js and others, with their heaps) and the working set of every WebView2 process by type, plus
// the shell and its local Postgres.
// --dump adds Chromium's own split of each process (blink_gc, malloc, v8, cc tiles, gpu, web_cache...)
// from a light memory-infra dump; it takes about 5 s.
import { execFileSync } from "node:child_process";
import { send, close } from "./cdp.mjs";

const port = process.env.CDP_PORT ?? "9223";
const MB = (bytes) => Math.round((bytes / 1048576) * 10) / 10;

/** Every live object whose prototype chain holds `protoExpr`, reduced in the page by `fn(objects)`. */
async function sumObjects(protoExpr, fn) {
  const proto = await send("Runtime.evaluate", { expression: protoExpr });
  const protoId = proto.result?.result?.objectId;
  if (!protoId) return null;
  const found = await send("Runtime.queryObjects", { prototypeObjectId: protoId });
  const arrayId = found.result?.objects?.objectId;
  if (!arrayId) return null;
  const r = await send("Runtime.callFunctionOn", { objectId: arrayId, functionDeclaration: fn, returnByValue: true });
  return r.result?.result?.value ?? null;
}

/** Heap of one worker target, through its own DevTools socket. */
async function workerHeap(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
    });
    ws.send(JSON.stringify({ id: 1, method: "Runtime.getHeapUsage" }));
    // Workers announce themselves first (Inspector.workerScriptLoaded); wait for the reply to id 1.
    const reply = await new Promise((resolve) =>
      ws.addEventListener("message", (ev) => {
        const d = JSON.parse(ev.data);
        if (d.id === 1) resolve(d);
      }),
    );
    // usedSize is the worker's JS heap; backingStorageSize is its ArrayBuffers (PDF bytes, decoded images).
    return (reply.result?.usedSize ?? 0) + (reply.result?.backingStorageSize ?? 0);
  } catch {
    return 0;
  } finally {
    ws.close();
  }
}

/** Working set and private bytes of the WebView2 processes the CDP browser reports, grouped by type. */
async function processes() {
  const browser = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
  const ws = new WebSocket(browser.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve));
  ws.send(JSON.stringify({ id: 1, method: "SystemInfo.getProcessInfo" }));
  const reply = await new Promise((resolve) => ws.addEventListener("message", (ev) => resolve(JSON.parse(ev.data))));
  ws.close();
  const infos = reply.result?.processInfo ?? [];
  if (process.platform !== "win32" || infos.length === 0) return { byType: {}, infos };
  const ids = infos.map((p) => p.id).join(",");
  const ps = `Get-Process -Id ${ids} -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`;
  const raw = execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).trim();
  const rows = raw ? [].concat(JSON.parse(raw)) : [];
  const byType = {};
  for (const info of infos) {
    const row = rows.find((r) => r.Id === info.id);
    if (!row) continue;
    const t = (byType[info.type] ??= { count: 0, workingSetMB: 0, privateMB: 0 });
    t.count += 1;
    t.workingSetMB = MB(t.workingSetMB * 1048576 + row.WorkingSet64);
    t.privateMB = MB(t.privateMB * 1048576 + row.PrivateMemorySize64);
  }
  // The app's own processes beside the webview: the Tauri shell and the local Postgres.
  // Only postgres whose parent chain reaches a weaveforge-shell: other Postgres on the machine is not ours.
  const own = `
$p = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name -ErrorAction SilentlyContinue)
$by = @{}; foreach ($x in $p) { $by[[int]$x.ProcessId] = $x }
$shells = @($p | Where-Object { $_.Name -eq 'weaveforge-shell.exe' } | ForEach-Object { [int]$_.ProcessId })
$pg = @()
foreach ($x in @($p | Where-Object { $_.Name -eq 'postgres.exe' })) {
  $cur = $x; $hops = 0
  while ($cur -and $hops -lt 64) {
    $up = [int]$cur.ParentProcessId
    if ($shells -contains $up) { $pg += [int]$x.ProcessId; break }
    $cur = $by[$up]; $hops++
  }
}
$ids = @($shells) + @($pg)
if ($ids.Count) { Get-Process -Id $ids -ErrorAction SilentlyContinue | Select-Object ProcessName,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress }`;
  const ownRaw = execFileSync("powershell", ["-NoProfile", "-Command", own], { encoding: "utf8" }).trim();
  for (const row of ownRaw ? [].concat(JSON.parse(ownRaw)) : []) {
    const t = (byType[row.ProcessName === "postgres" ? "postgres" : "shell"] ??= { count: 0, workingSetMB: 0, privateMB: 0 });
    t.count += 1;
    t.workingSetMB = MB(t.workingSetMB * 1048576 + row.WorkingSet64);
    t.privateMB = MB(t.privateMB * 1048576 + row.PrivateMemorySize64);
  }
  return { byType };
}

/** Chromium's allocator totals per process (two levels deep, > 0.5 MB), from a light memory dump. */
async function allocatorDump() {
  const browser = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
  const ws = new WebSocket(browser.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve));
  let next = 0;
  const pending = new Map();
  const events = [];
  let complete;
  const completed = new Promise((resolve) => (complete = resolve));
  ws.addEventListener("message", (ev) => {
    const d = JSON.parse(ev.data);
    if (d.id && pending.has(d.id)) pending.get(d.id)(d);
    else if (d.method === "Tracing.dataCollected") events.push(...d.params.value);
    else if (d.method === "Tracing.tracingComplete") complete();
  });
  const call = (method, params = {}) =>
    new Promise((resolve) => {
      const i = ++next;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await call("Tracing.start", {
    traceConfig: { includedCategories: ["disabled-by-default-memory-infra"], memoryDumpConfig: { triggers: [] } },
    transferMode: "ReportEvents",
  });
  await wait(500);
  // "detailed" never returns the renderer's allocators here; "light" does.
  await call("Tracing.requestMemoryDump", { deterministic: true, levelOfDetail: "light" });
  await wait(4000);
  await call("Tracing.end");
  await Promise.race([completed, wait(15000)]);
  ws.close();
  const names = {};
  for (const e of events) if (e.ph === "M" && e.name === "process_name") names[e.pid] = e.args.name;
  const hex = (v) => parseInt(v ?? "0", 16);
  // A process reports its totals and its allocators in separate events; merge them by pid.
  const byPid = new Map();
  for (const e of events.filter((e) => e.ph === "v")) {
    const p = byPid.get(e.pid) ?? { process: names[e.pid] ?? String(e.pid), privateFootprintMB: 0, parts: {} };
    const footprint = MB(hex(e.args.dumps.process_totals?.private_footprint_bytes));
    if (footprint > p.privateFootprintMB) p.privateFootprintMB = footprint;
    for (const [name, v] of Object.entries(e.args.dumps.allocators ?? {})) {
      // Two levels deep; global/ and shared_memory/<id> are cross-process handles, counted elsewhere.
      if (name.split("/").length > 2 || /^(global|shared_memory)\//.test(name)) continue;
      const mb = MB(hex(v.attrs?.effective_size?.value ?? v.attrs?.size?.value));
      if (mb > 0.5) p.parts[name] = mb;
    }
    byPid.set(e.pid, p);
  }
  return [...byPid.values()]
    .filter((p) => !p.process.includes("Tracing"))
    .map(({ process: name, privateFootprintMB, parts }) => ({
      process: name,
      privateFootprintMB,
      allocatorsMB: Object.fromEntries(Object.entries(parts).sort((a, b) => b[1] - a[1]).slice(0, 25)),
    }));
}

await send("Performance.enable");
await send("HeapProfiler.enable");
await send("HeapProfiler.collectGarbage");
const metrics = Object.fromEntries((await send("Performance.getMetrics")).result.metrics.map((m) => [m.name, m.value]));
const page = (
  await send("Runtime.evaluate", {
    returnByValue: true,
    expression: String.raw`(() => {
      const imgs = [...document.images];
      return {
        url: location.pathname,
        domNodes: document.getElementsByTagName("*").length,
        iframes: document.querySelectorAll("iframe").length,
        images: imgs.length,
        imagePixelsMB: imgs.reduce((s, i) => s + i.naturalWidth * i.naturalHeight * 4, 0) / 1048576,
        fontsLoaded: [...document.fonts].filter((f) => f.status === "loaded").length,
        dpr: devicePixelRatio,
      };
    })()`,
  })
).result.result.value;

const pixels = `function () {
  let n = 0, px = 0, detached = 0, detachedPx = 0, hidden = 0, hiddenPx = 0, biggest = [];
  for (const c of this) {
    const p = c.width * c.height * 4;
    n++; px += p;
    if (!c.isConnected) { detached++; detachedPx += p; }
    else if (c.offsetParent === null) { hidden++; hiddenPx += p; }
    biggest.push([p, (c.isConnected ? "" : "detached ") + (c.className || c.parentElement?.className || "?").toString().slice(0, 50) + " " + c.width + "x" + c.height]);
  }
  biggest.sort((a, b) => b[0] - a[0]);
  return { n, px, detached, detachedPx, hidden, hiddenPx, top: biggest.slice(0, 6).map((b) => b[1]) };
}`;
const canvases = await sumObjects("HTMLCanvasElement.prototype", pixels);
const offscreen = await sumObjects(
  "typeof OffscreenCanvas === 'undefined' ? undefined : OffscreenCanvas.prototype",
  "function () { let n = 0, px = 0; for (const c of this) { n++; px += c.width * c.height * 4; } return { n, px }; }",
);
const bitmaps = await sumObjects(
  "ImageBitmap.prototype",
  "function () { let n = 0, px = 0; for (const b of this) { n++; px += b.width * b.height * 4; } return { n, px }; }",
);
const wasm = await sumObjects(
  "WebAssembly.Memory.prototype",
  "function () { return this.map((m) => { try { return m.buffer.byteLength; } catch { return 0; } }); }",
);

const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
const workers = [];
for (const t of targets.filter((t) => t.type === "worker" || t.type === "service_worker" || t.type === "shared_worker")) {
  workers.push({ url: t.url.replace(/^https?:\/\/[^/]+/, ""), heapMB: MB(await workerHeap(t)) });
}
const procs = await processes();
const dump = process.argv.includes("--dump") ? await allocatorDump() : undefined;
close();

const report = {
  url: page.url,
  jsHeapUsedMB: MB(metrics.JSHeapUsedSize),
  jsHeapTotalMB: MB(metrics.JSHeapTotalSize),
  wasmMemoriesMB: (wasm ?? []).map(MB),
  domNodes: page.domNodes,
  documents: metrics.Documents,
  jsEventListeners: metrics.JSEventListeners,
  iframes: page.iframes,
  canvases: canvases && {
    count: canvases.n,
    backingMB: MB(canvases.px),
    hidden: canvases.hidden,
    hiddenMB: MB(canvases.hiddenPx),
    detached: canvases.detached,
    detachedMB: MB(canvases.detachedPx),
    largest: canvases.top,
  },
  offscreenCanvases: offscreen && { count: offscreen.n, backingMB: MB(offscreen.px) },
  imageBitmaps: bitmaps && { count: bitmaps.n, MB: MB(bitmaps.px) },
  images: { count: page.images, decodedMB: MB(page.imagePixelsMB * 1048576) },
  fontsLoaded: page.fontsLoaded,
  devicePixelRatio: page.dpr,
  workers,
  processes: procs.byType,
  allocators: dump,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const total = Object.values(report.processes).reduce((s, p) => s + p.workingSetMB, 0);
  console.log(`page ${report.url}  dpr ${report.devicePixelRatio}`);
  console.log(`JS heap          ${report.jsHeapUsedMB} MB used / ${report.jsHeapTotalMB} MB total`);
  console.log(`wasm memory      ${report.wasmMemoriesMB.join(" + ") || 0} MB`);
  console.log(`DOM              ${report.domNodes} nodes, ${report.documents} documents, ${report.iframes} iframes, ${report.jsEventListeners} listeners`);
  if (report.canvases) {
    const c = report.canvases;
    console.log(`canvases         ${c.count} = ${c.backingMB} MB (hidden ${c.hidden} = ${c.hiddenMB} MB, detached ${c.detached} = ${c.detachedMB} MB)`);
    for (const line of c.largest) console.log(`                   ${line}`);
  }
  if (report.offscreenCanvases) console.log(`offscreen        ${report.offscreenCanvases.count} = ${report.offscreenCanvases.backingMB} MB`);
  if (report.imageBitmaps) console.log(`ImageBitmaps     ${report.imageBitmaps.count} = ${report.imageBitmaps.MB} MB`);
  console.log(`images           ${report.images.count} = ${report.images.decodedMB} MB decoded`);
  console.log(`fonts loaded     ${report.fontsLoaded}`);
  for (const w of report.workers) console.log(`worker           ${w.url}  heap + buffers ${w.heapMB} MB`);
  for (const [type, p] of Object.entries(report.processes)) {
    console.log(`process ${type.padEnd(9)} x${p.count}  working set ${p.workingSetMB} MB, private ${p.privateMB} MB`);
  }
  console.log(`processes total  ${Math.round(total)} MB working set`);
  for (const d of report.allocators ?? []) {
    console.log(`
${d.process}: private footprint ${d.privateFootprintMB} MB`);
    for (const [name, mb] of Object.entries(d.allocatorsMB)) console.log(`  ${name.padEnd(40)} ${mb} MB`);
  }
}
