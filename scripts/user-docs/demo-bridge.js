// The docs' demo app: the real app's static export with this script first in
// every page's <head> (build-demo-app.mjs). It stands in for the desktop shell
// (window.weaveforge, apps/web/src/lib/desktop/desktop-bridge.ts) over the workspace
// demo-workspace.mts built. Every load starts from that copy; edits stay in this
// page's memory, so readers see the same demo thesis every time.
// It also takes the docs page's messages: theme, ring around a control, actions.
(function () {
  "use strict";
  const BASE = "/_demo/";

  // The demo project is open, unless the docs ask for the list of projects
  // (?docsProject=none), which the app shows when no project is open.
  const params = new URLSearchParams(location.search);
  const project = params.get("docsProject") === "none" ? null : document.currentScript && document.currentScript.dataset.project;
  try {
    localStorage.setItem("weaveforge.local-mode", "1");
    if (project) localStorage.setItem("thesis.projectId", project);
    else localStorage.removeItem("thesis.projectId");
  } catch { /* no storage: sign-in screen */ }

  // The one paper with a PDF (demo-workspace.mts). The docs name it ?paper=demo, since
  // its id changes with every build; swapped before the app reads the URL.
  const pdfPaper = document.currentScript && document.currentScript.dataset.pdfPaper;
  if (params.get("paper") === "demo" && pdfPaper) {
    params.set("paper", pdfPaper);
    history.replaceState(history.state, "", location.pathname + "?" + params + location.hash);
  }

  // The docs open the demo in their own theme (?docsTheme=…&docsMode=…), saved the
  // way apps/web/src/lib/theme/theme.ts reads it, before the app's scripts run.
  const theme = params.get("docsTheme");
  const mode = params.get("docsMode") === "dark" ? "dark" : "light";
  if (theme) {
    try {
      localStorage.setItem("thesis.mode", mode);
      localStorage.setItem("thesis.theme." + mode, theme);
    } catch { /* no storage: the app's default theme */ }
    document.documentElement.dataset.mode = mode;
    if (theme === "light") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }

  // The demo workspace: text files inline, binary files (the charts) fetched when
  // first read. Writes live in `store` only, so nothing outlives the page.
  const store = new Map();
  const ready = (async () => {
    const ws = await fetch(BASE + "workspace.json").then((r) => r.json());
    for (const [path, entry] of Object.entries(ws.files)) {
      store.set(path, "text" in entry ? { text: entry.text } : { url: BASE + entry.file });
    }
    if (pdfPaper && params.has("paper")) await cachePdf(pdfPaper).catch(() => {});
    return ws;
  })();

  // Workspace paths are relative to the root, with no leading or trailing slash.
  const key = (p) => String(p || "").replace(/^\.?\/+/, "").replace(/\/+$/, "");
  const under = (dir) => (dir ? dir + "/" : "");
  const now = () => new Date().toISOString();
  const sizeOf = (e) => (e.text !== undefined ? new TextEncoder().encode(e.text).byteLength : e.bytes ? e.bytes.byteLength : 0);
  const fileEntry = (path, e) => ({ path, kind: "file", size: sizeOf(e), modifiedAt: now() });
  const dirEntry = (path) => ({ path, kind: "dir", size: 0, modifiedAt: now() });
  async function bytesOf(e) {
    if (e.text !== undefined) return new TextEncoder().encode(e.text);
    if (!e.bytes) e.bytes = new Uint8Array(await (await fetch(e.url)).arrayBuffer());
    return e.bytes;
  }

  // Put the demo PDF where the reader's browser cache looks for it, keyed by paper
  // id (IndexedDbPdfByteCache, apps/web/src/features/reader/infrastructure/parts-1.ts).
  // Done before the app opens the paper, so the reader cannot ask first.
  async function cachePdf(paperId) {
    const bytes = await (await fetch(BASE + "demo-paper.pdf")).arrayBuffer();
    const idb = await new Promise((resolve, reject) => {
      const req = indexedDB.open("weaveforge-pdf-cache", 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("pdfs")) req.result.createObjectStore("pdfs", { keyPath: "key" }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
      const tx = idb.transaction("pdfs", "readwrite");
      tx.objectStore("pdfs").put({ key: paperId, bytes, updatedAt: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    idb.close();
  }

  if (parent !== window) {
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (opts) { focus.call(this, { ...opts, preventScroll: true }); reveal(this); };
    Element.prototype.scrollIntoView = function () { reveal(this); };
  }

  const none = async () => null;
  const nothing = async () => undefined;
  const off = () => () => {};
  const NO_ACCOUNT = "The demo has no account.";

  window.weaveforge = {
    version: "docs-demo",
    platform: "linux",
    fetchTitle: async (url) => ({ title: url, url }),
    fetchImage: async () => { throw new Error(NO_ACCOUNT); },
    onVaultChange: off,
    onSignIn: off,
    checkUpdate: none,
    writePreference: nothing,
    readSecret: none,
    writeSecret: nothing,
    clearSecret: nothing,
    chooseVaultRoot: none,
    vaultRoot: async () => ({ path: "demo-workspace", state: "existing" }),
    async readVaultFile(p) {
      await ready;
      const e = store.get(key(p));
      return e ? new TextDecoder().decode(await bytesOf(e)) : null;
    },
    async writeVaultFile(p, text) {
      await ready;
      store.set(key(p), { text: String(text) });
    },
    async writeVaultFileIf(p, text, expected) {
      await ready;
      const cur = store.get(key(p));
      const now = cur ? new TextDecoder().decode(await bytesOf(cur)) : null;
      if (now !== expected) return false;
      store.set(key(p), { text: String(text) });
      return true;
    },
    async readVaultBytes(p) {
      await ready;
      const e = store.get(key(p));
      return e ? bytesOf(e) : null;
    },
    async writeVaultBytes(p, bytes) {
      await ready;
      store.set(key(p), { bytes: new Uint8Array(bytes) });
    },
    async listVaultFiles(dir = "") {
      await ready;
      const base = under(key(dir));
      const out = new Map();
      for (const [p, e] of store) {
        if (!p.startsWith(base)) continue;
        const rest = p.slice(base.length);
        const slash = rest.indexOf("/");
        if (slash < 0) out.set(p, fileEntry(p, e));
        else {
          const d = base + rest.slice(0, slash);
          if (!out.has(d)) out.set(d, dirEntry(d));
        }
      }
      return [...out.values()];
    },
    async statVaultFile(p) {
      await ready;
      const k = key(p);
      const e = store.get(k);
      if (e) return fileEntry(k, e);
      if (k === "" || [...store.keys()].some((x) => x.startsWith(k + "/"))) return dirEntry(k);
      return null;
    },
    async removeVaultFile(p) {
      await ready;
      const k = key(p);
      for (const x of [...store.keys()]) if (x === k || x.startsWith(k + "/")) store.delete(x);
    },
    commitVault: async () => ({ commit: null, reason: NO_ACCOUNT }),
    vaultLog: async () => [],
    localApiState: async () => ({ enabled: false, url: "" }),
    setLocalApi: async () => ({ enabled: false, url: "" }),
    createLocalApiToken: async () => ({ enabled: false, url: "" }),
    revokeLocalApiToken: async () => ({ enabled: false, url: "" }),
    zoteroLocal: async () => ({ status: 503, body: "", headers: {} }),
    onSemanticRank: off,
    readOverleafProject: async () => { throw new Error(NO_ACCOUNT); },
    inkAvailable: async () => false,
    inkRecognise: async () => { throw new Error(NO_ACCOUNT); },
    inkHapticsAvailable: async () => false,
    inkHaptics: () => {},
  };

  // --- the docs page's messages ---------------------------------------------
  let ring;
  function ringEl() {
    if (!ring) {
      ring = document.createElement("div");
      ring.setAttribute("aria-hidden", "true");
      ring.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:3px solid var(--accent);border-radius:10px;box-shadow:0 0 0 4px color-mix(in srgb, var(--accent) 30%, transparent);display:none";
      document.body.appendChild(ring);
    }
    return ring;
  }
  const words = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  // A control by what the reader sees on it: its text, its label or its title.
  function find(label) {
    const want = words(label);
    const all = [...document.querySelectorAll("button, a, [role=button], [role=tab], [role=menuitem], [role=option], [role=switch], label, summary, h1, h2, h3, li, input, select, textarea")].filter(visible);
    const name = (el) => words(el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || el.textContent);
    return all.find((el) => name(el) === want) || all.find((el) => name(el).startsWith(want)) || all.find((el) => name(el).includes(want)) || null;
  }
  // Scroll a control into view inside the demo only. The browser's scrollIntoView
  // and focus() also scroll the docs page around the frame, which pulls the reader
  // off the text and swaps which demo runs; the app's own calls go through here too.
  function reveal(el) {
    for (let box = el.parentElement; box; box = box.parentElement) {
      if (box.scrollHeight <= box.clientHeight && box.scrollWidth <= box.clientWidth) continue;
      const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
      if (r.top < b.top) box.scrollTop -= b.top - r.top;
      else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
      if (r.left < b.left) box.scrollLeft -= b.left - r.left;
      else if (r.right > b.right) box.scrollLeft += r.right - b.right;
    }
  }
  function show(label) {
    const r0 = ringEl();
    const el = label && find(label);
    if (!el) { r0.style.display = "none"; return; }
    reveal(el);
    const r = el.getBoundingClientRect();
    Object.assign(r0.style, { display: "block", left: r.left - 6 + "px", top: r.top - 6 + "px", width: r.width + 12 + "px", height: r.height + 12 + "px" });
  }
  // Short enough that a bold word which is not a control does not stall the replay.
  const until = async (fn, ms = 3000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) {
      const v = fn();
      if (v) return v;
    }
    return null;
  };
  // Steps the docs page asks for: "Label" clicks a control, "open:Title" opens a
  // list item, "key:ctrl+k" presses a shortcut, "type:Label=text" fills a field.
  async function act(step) {
    if (step.startsWith("key:")) {
      const parts = step.slice(4).split("+");
      const key = parts.pop();
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ctrlKey: parts.includes("ctrl"), metaKey: parts.includes("meta"), shiftKey: parts.includes("shift") }));
      return;
    }
    if (step.startsWith("type:")) {
      const [label, text] = step.slice(5).split("=");
      const el = await until(() => find(label));
      if (!el) return;
      el.focus();
      const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
      set ? set.call(el, text) : (el.value = text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const el = await until(() => find(step.replace(/^open:/, "")));
    el?.click();
  }
  // Another how-to's screen, in the running app: the router, not a new page, so the
  // app and its in-memory workspace stay. Only a different open project needs a fresh start.
  async function goTo(href) {
    const url = new URL(href, location.href);
    const want = url.searchParams.get("docsProject") === "none" ? null : project;
    let have = null;
    try { have = localStorage.getItem("thesis.projectId"); } catch { /* no storage */ }
    if ((want || null) !== (have || null)) {
      location.href = url.href; // this script sets the project; the new page reports in
      return new Promise(() => {});
    }
    if (url.searchParams.get("paper") === "demo" && pdfPaper) {
      url.searchParams.set("paper", pdfPaper);
      await cachePdf(pdfPaper).catch(() => {});
    }
    show(null);
    for (const t of [document.activeElement, document]) t && t.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    window.next.router.push(url.pathname + url.search);
    await until(() => location.pathname === url.pathname && document.querySelector("button"), 5000);
    await new Promise((r) => setTimeout(r, 300));
  }
  // Nothing runs before the demo workspace is loaded and the app has drawn a control.
  let queue = ready.then(() => until(() => document.querySelector("button"), 15000), () => {})
    .then(() => { if (parent !== window) parent.postMessage({ docsReady: true }, "*"); });
  // The latest switch; work queued for an older one is dropped, so scrolling past
  // a how-to does not make the one the reader stops at wait for it.
  let latest = 0;
  window.addEventListener("message", (e) => {
    const d = e.data || {};
    if (d.docsTheme) document.documentElement.dataset.theme = d.docsTheme;
    if (d.docsMode) document.documentElement.dataset.mode = d.docsMode;
    if ("docsStart" in d) latest = d.docsStart;
    const mine = latest;
    const live = () => mine === latest;
    const steps = async () => { for (const s of d.docsDo || []) { if (!live()) return; await act(s); await new Promise((r) => setTimeout(r, 250)); } };
    // docsStart: open a how-to (docsGo), do its first steps, then say so with the same ticket.
    if ("docsStart" in d) queue = queue.then(async () => { if (!live()) return; if (d.docsGo) await goTo(d.docsGo); await steps(); if (live()) parent.postMessage({ docsReady: d.docsStart }, "*"); });
    else if (Array.isArray(d.docsDo)) queue = queue.then(steps);
    if ("docsRing" in d) queue = queue.then(() => live() && until(() => !d.docsRing || find(d.docsRing), 4000)).then(() => live() && requestAnimationFrame(() => show(d.docsRing)));
  });
})();
