#!/usr/bin/env node
/**
 * Frozen views of the real app for the user docs.
 *
 * Drives a running WeaveForge Dev desktop app over the Chrome DevTools Protocol
 * (WebView2 started with --remote-debugging-port), loaded with the demo workspace.
 * A view is the app's own DOM at one moment, saved as a static HTML file with the
 * scripts removed: the docs show it in an inert frame, so nothing can be edited,
 * and the app's CSS lets it follow every docs theme.
 *
 * For each page in scripts/user-docs/views.json (page -> route and setup clicks):
 *   - views/<page>/hero.html: the screen after setup. Each how-to step whose
 *     **bold** control is on that screen gets `data-docs-ring="<page/task/step>"`
 *     on the control, so the docs can ring it.
 *   - views/<page>/<task>-<n>.html: when a step opens a menu, it is clicked and
 *     the rest of the task is captured on the next screen.
 * Steps whose control is never on screen get no view (never a mock).
 * Shared files: views/app.css (the app's stylesheets), views/assets/ (fonts and
 * images the CSS uses), views/view.js (theme and ring), views/index.json.
 *
 *   node scripts/capture-docs-views.mjs [--port 9223] [--origin https://app.localhost] [--only <page>]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { decorate, stripFrontMatter } from "./lib/user-docs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "docs", "using");
const OUT = join(SRC, "views");
const SETUPS = JSON.parse(readFileSync(join(ROOT, "scripts", "user-docs", "views.json"), "utf8"));

function args(argv) {
  const out = { port: "9223", origin: "https://app.localhost", only: null };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    if (!(key in out) || argv[i + 1] === undefined) throw new Error(`capture: unknown or empty option ${argv[i]}`);
    out[key] = argv[i + 1];
  }
  return out;
}

async function connect(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = list.find((p) => p.type === "page" && !p.url.startsWith("devtools"));
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const data = JSON.parse(ev.data);
    if (data.id && pending.has(data.id)) pending.get(data.id)(data), pending.delete(data.id);
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const n = ++id;
      pending.set(n, resolve);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const run = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "eval failed");
    return r.result.result.value;
  };
  return { send, run, close: () => ws.close() };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Each how-to step with a key `page/task/step` and the bold names in it. */
function stepsOf(page) {
  const raw = readFileSync(join(SRC, `${page}.md`), "utf8");
  const html = decorate(marked.parse(stripFrontMatter(raw)), page, () => null);
  const steps = [];
  for (const m of html.matchAll(/data-ring="([^"]+)">([\s\S]*?)(?=<li class="wf-item docs-step"|<\/ol>)/g)) {
    const names = [...m[2].matchAll(/<strong>([\s\S]*?)<\/strong>/g)].map((b) => b[1].replace(/<[^>]+>/g, "").trim());
    if (names.length) steps.push({ key: m[1], names });
  }
  return steps;
}

// Runs in the app: finds the visible control a step names ("Settings › Account" -> "Account")
// and, given a key, marks it for the ring.
const FIND = `(name, key) => {
  const want = name.split(/\\s*[›>→]\\s*/).pop().replace(/[…\\.]+$/, "").trim().toLowerCase();
  if (!want) return null;
  const sel = "button,a,[role=button],[role=tab],[role=menuitem],[role=option],[role=switch],[role=checkbox],label,summary,input,select,textarea,h1,h2,h3";
  const label = (el) => (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("title") || el.textContent || "")
    .replace(/\\s+/g, " ").replace(/[…\\.]+$/, "").trim().toLowerCase();
  const seen = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && getComputedStyle(el).visibility !== "hidden"; };
  // Controls in the page body win over the sidebar, which repeats many names ("Lists", "Tags").
  const vis = [...document.querySelectorAll(sel)].filter(seen);
  const all = [...vis.filter((e) => e.closest("main")), ...vis.filter((e) => !e.closest("main"))];
  // A card-like button reads title + description; its first text holds the title alone.
  const head = (e) => {
    const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.data.trim() ? 1 : 3) });
    return (w.nextNode()?.data || "").replace(/\\s+/g, " ").trim().toLowerCase();
  };
  const el = all.find((e) => label(e) === want || head(e) === want) || all.find((e) => label(e).startsWith(want) && label(e).length < want.length + 24);
  if (!el) return null;
  if (key) el.setAttribute("data-docs-ring", ((el.getAttribute("data-docs-ring") || "") + " " + key).trim());
  else el.click();
  return { menu: el.hasAttribute("aria-haspopup") || el.hasAttribute("aria-expanded") };
}`;

// Runs in the app: the page as static HTML (no scripts, canvases and images inlined,
// form values and scroll positions kept) plus its stylesheets.
const SNAPSHOT = `async () => {
  const dataUrl = (blob) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
  const canvases = [...document.querySelectorAll("canvas")].map((c) => { try { return ({ src: c.toDataURL("image/webp", 0.85), w: c.clientWidth, h: c.clientHeight }); } catch { return null; } });
  const images = await Promise.all([...document.querySelectorAll("img")].map(async (img) => {
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith("data:")) return null;
    try { return await dataUrl(await (await fetch(src)).blob()); } catch { return null; }
  }));
  const scrolled = [...document.querySelectorAll("*")].filter((e) => e.scrollTop || e.scrollLeft);
  scrolled.forEach((e) => e.setAttribute("data-docs-scroll", e.scrollTop + "," + e.scrollLeft));
  const fields = [...document.querySelectorAll("input,textarea,select")];
  const root = document.documentElement.cloneNode(true);
  scrolled.forEach((e) => e.removeAttribute("data-docs-scroll"));
  root.querySelectorAll("canvas").forEach((c, i) => {
    if (!canvases[i]) return;
    const img = document.createElement("img");
    img.src = canvases[i].src;
    img.setAttribute("style", (c.getAttribute("style") || "") + ";width:" + canvases[i].w + "px;height:" + canvases[i].h + "px");
    img.className = c.className;
    c.replaceWith(img);
  });
  root.querySelectorAll("img").forEach((img, i) => { img.removeAttribute("srcset"); img.removeAttribute("loading"); if (images[i]) img.src = images[i]; });
  root.querySelectorAll("input,textarea,select").forEach((f, i) => {
    const live = fields[i];
    if (!live) return;
    if (f.tagName === "TEXTAREA") f.textContent = live.value;
    else if (f.tagName === "SELECT") [...f.options].forEach((o, j) => o.toggleAttribute("selected", live.options[j]?.selected));
    else if (live.type === "checkbox" || live.type === "radio") f.toggleAttribute("checked", live.checked);
    else if (live.type !== "password" && live.type !== "file") f.setAttribute("value", live.value);
  });
  root.querySelectorAll("script,noscript,link,style,iframe,template,meta,title,base").forEach((e) => e.remove());
  root.querySelectorAll("[contenteditable]").forEach((e) => e.setAttribute("contenteditable", "false"));
  const sheets = [...document.styleSheets].map((s) => {
    try { return { href: s.href || location.href, css: [...s.cssRules].map((r) => r.cssText).join("\\n") }; } catch { return null; }
  }).filter(Boolean);
  return { html: root.outerHTML, sheets, size: [innerWidth, innerHeight] };
}`;

async function go(app, url) {
  await app.run(`location.href = ${JSON.stringify(url)}`);
  await wait(400);
  for (let i = 0; i < 40; i++) {
    if (await app.run(`document.readyState === "complete" && !document.querySelector("[aria-busy=true]")`).catch(() => false)) break;
    await wait(150);
  }
  await wait(1500); // data loads and transitions settle
  // A canvas (the graph) keeps drawing while its layout runs: wait until it stops changing.
  const drawn = `[...document.querySelectorAll("canvas")].map((c) => c.toDataURL().length).join()`;
  for (let i = 0, last = ""; i < 20; i++) {
    const now = await app.run(drawn);
    if (now === last) break;
    last = now;
    await wait(500);
  }
}

// Opens the page's starting screen: its route, then each setup action in order.
// An action is a control's name, "open:<card title>" or "key:ctrl+k".
async function enter(app, origin, setup) {
  await go(app, `${origin}/${setup.route}`);
  for (const act of setup.do ?? []) {
    let ok;
    if (act.startsWith("open:")) {
      ok = await app.run(`(() => {
        const h = [...document.querySelectorAll("main h3")].find((e) => e.textContent.trim() === ${JSON.stringify(act.slice(5))});
        const b = h && document.querySelector('[aria-labelledby="' + h.id + '"]');
        return b ? (b.click(), true) : false;
      })()`);
    } else if (act.startsWith("key:")) {
      const parts = act.slice(4).split("+");
      const key = parts.pop();
      const mods = Object.fromEntries(parts.map((m) => [`${m}Key`, true]));
      ok = await app.run(`document.dispatchEvent(new KeyboardEvent("keydown", ${JSON.stringify({ key, bubbles: true, ...mods })})), true`);
    } else {
      ok = await app.run(`(${FIND})(${JSON.stringify(act)}, null)`);
    }
    if (!ok) console.warn(`capture: setup step "${act}" not found on ${setup.route}`);
    await wait(1000);
  }
}

// Stylesheets and their assets are shared by every view; collected across the run.
const sheets = new Map(); // hash -> css
const assets = new Map(); // absolute url -> file name in views/assets
let size = null;

async function save(app, name) {
  const snap = await app.run(`(${SNAPSHOT})()`);
  size ??= snap.size;
  for (const { href, css } of snap.sheets) {
    const fixed = css.replace(/url\((['"]?)([^'")]+)\1\)/g, (all, _q, url) => {
      if (url.startsWith("data:") || url.startsWith("#")) return all;
      const abs = new URL(url, href).href;
      // Only woff2 among fonts: every face lists it first, so the others are never fetched.
      if (/\.(woff|ttf|eot|otf)(\?|$)/.test(abs)) return all;
      if (!assets.has(abs)) assets.set(abs, `${createHash("sha1").update(abs).digest("hex").slice(0, 10)}-${abs.split("/").pop().split("?")[0]}`);
      return `url("assets/${assets.get(abs)}")`;
    });
    const hash = createHash("sha1").update(fixed).digest("hex");
    if (!sheets.has(hash)) sheets.set(hash, fixed);
  }
  const html = snap.html
    .replace(/<head>/, `<head><meta charset="utf-8"><link rel="stylesheet" href="../app.css"><script src="../view.js" defer></script>`)
    .replace(/<body([^>]*)>/, "<body$1 inert>");
  const file = join(OUT, `${name}.html`);
  mkdirSync(dirname(file), { recursive: true });
  // Paths on screen (log locations, error lines) name the capturing machine's user.
  const scrubbed = html.replace(/(\\\\\?\\)?([A-Za-z]:)?\\Users\\[^\\<"\s]+/g, "C:\\Users\\you")
    .replace(/\\AppData\\Local\\Temp\\[^<"\s]*/g, "\\AppData\\Local\\Temp\\…");
  writeFileSync(file, `<!doctype html>\n${scrubbed}\n`);
  return `${name}.html`;
}

async function writeAssets(app) {
  mkdirSync(join(OUT, "assets"), { recursive: true });
  for (const [url, file] of assets) {
    const target = join(OUT, "assets", file);
    if (existsSync(target)) continue;
    const b64 = await app.run(`(async () => {
      const r = await fetch(${JSON.stringify(url)});
      if (!r.ok) return null;
      const b = new Uint8Array(await r.arrayBuffer());
      let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768));
      return btoa(s);
    })()`).catch(() => null);
    if (b64) writeFileSync(target, Buffer.from(b64, "base64"));
    else console.warn(`capture: could not fetch ${url}`);
  }
  writeFileSync(join(OUT, "app.css"), [...sheets.values()].join("\n"));
  copyFileSync(join(ROOT, "scripts", "user-docs", "view.js"), join(OUT, "view.js"));
}

async function capturePage(app, origin, page, setup, views) {
  const steps = stepsOf(page);
  const byTask = new Map();
  for (const s of steps) byTask.set(s.key.split("/")[1], [...(byTask.get(s.key.split("/")[1]) ?? []), s]);

  // First pass: every task starts on the hero screen; ring what is there, up to a menu.
  await enter(app, origin, setup);
  const later = []; // [task, index of the menu step]
  const onHero = [];
  for (const [task, list] of byTask) {
    for (let i = 0; i < list.length; i++) {
      let found = null;
      for (const name of list[i].names) if ((found = await app.run(`(${FIND})(${JSON.stringify(name)}, ${JSON.stringify(list[i].key)})`))) break;
      if (!found) continue;
      onHero.push(list[i].key);
      if (found.menu) {
        later.push([task, i]);
        break;
      }
    }
  }
  const hero = await save(app, `${page}/hero`);
  views[`${page}/hero`] = hero;
  for (const key of onHero) views[key] = hero;

  // Second pass: open each menu and capture the rest of that task on the screens that follow.
  for (const [task, from] of later) {
    const list = byTask.get(task);
    await enter(app, origin, setup);
    let n = 0;
    let pending = [];
    const flush = async () => {
      if (!pending.length) return;
      const file = await save(app, `${page}/${task}-${++n}`);
      for (const key of pending) views[key] = file;
      pending = [];
    };
    for (let i = from; i < list.length; i++) {
      let found = null;
      for (const name of list[i].names) if ((found = await app.run(`(${FIND})(${JSON.stringify(name)}, ${JSON.stringify(list[i].key)})`))) break;
      if (!found) continue;
      if (i > from) pending.push(list[i].key);
      if (found.menu) {
        await flush();
        await app.run(`document.querySelector('[data-docs-ring~="${list[i].key}"]')?.click()`);
        await wait(700);
      }
    }
    await flush();
  }
  return Object.keys(views).filter((k) => k.startsWith(`${page}/`)).length;
}

const opts = args(process.argv.slice(2));
const pages = Object.entries(SETUPS).filter(([page]) => !opts.only || page === opts.only);
const known = new Set(readdirSync(SRC).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)));
for (const [page] of pages) if (!known.has(page)) throw new Error(`capture: no docs/using/${page}.md`);

const indexFile = join(OUT, "index.json");
const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, "utf8")) : { size: null, views: {} };
const views = Object.fromEntries(Object.entries(index.views).filter(([k]) => !pages.some(([p]) => k.startsWith(`${p}/`))));
const app = await connect(opts.port);
try {
  for (const [page, setup] of pages) console.log(`capture: ${page}: ${await capturePage(app, opts.origin, page, setup, views)} views`);
  await writeAssets(app);
} finally {
  app.close();
}
writeFileSync(indexFile, `${JSON.stringify({ size, views }, null, 2)}\n`);
