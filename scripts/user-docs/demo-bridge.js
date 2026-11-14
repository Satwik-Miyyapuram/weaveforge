// The docs' demo app: the real app's static export with this script first in
// every page's <head> (build-demo-app.mjs). It stands in for the desktop shell
// (window.weaveforge, apps/web/src/lib/desktop/desktop-bridge.ts) with PGlite in
// the page, opened on the database demo-db.mts built. Every load starts from that
// copy and nothing is saved, so readers see the same demo thesis every time.
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

  const ready = (async () => {
    const [{ PGlite }, { pgcrypto }, q, data, meta] = await Promise.all([
      import(BASE + "pglite/index.js"),
      import(BASE + "pglite/contrib/pgcrypto.js"),
      import(BASE + "demo-query.mjs"),
      fetch(BASE + "db.tar.gz").then((r) => r.blob()),
      fetch(BASE + "files.json").then((r) => r.json()),
    ]);
    const db = await PGlite.create({ loadDataDir: data, extensions: { pgcrypto }, parsers: q.DEMO_PARSERS });
    return { db, q, meta };
  })();

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
    async queryLocalDb(sql, params) {
      const { db, q, meta } = await ready;
      return q.localQuery(db, meta.claims, sql, params ?? []);
    },
    localDbState: async () => ({ failure: null, dataDir: "demo" }),
    resetLocalDb: nothing,
    async readLocalFile(bucket, path) {
      const b64 = (await ready).meta.files[bucket + "/" + path];
      return b64 ? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) : null;
    },
    async writeLocalFile(bucket, path, bytes) {
      let s = "";
      for (const b of bytes) s += String.fromCharCode(b);
      (await ready).meta.files[bucket + "/" + path] = btoa(s);
    },
    async removeLocalFile(bucket, path) { delete (await ready).meta.files[bucket + "/" + path]; },
    chooseVaultRoot: none,
    vaultRoot: none,
    readVaultFile: none,
    writeVaultFile: nothing,
    readVaultBytes: none,
    writeVaultBytes: nothing,
    listVaultFiles: async () => [],
    statVaultFile: none,
    removeVaultFile: nothing,
    commitVault: async () => ({ commit: null, reason: NO_ACCOUNT }),
    vaultLog: async () => [],
    localApiState: async () => ({ enabled: false, url: "" }),
    setLocalApi: async () => ({ enabled: false, url: "" }),
    createLocalApiToken: async () => ({ enabled: false, url: "" }),
    revokeLocalApiToken: async () => ({ enabled: false, url: "" }),
    zoteroLocal: async () => ({ status: 503, body: "", headers: {} }),
    probeTex: none,
    onSemanticRank: off,
    compileTex: async () => ({ ok: false, pdf: null, log: "", errors: [], engine: null }),
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
  function show(label) {
    const r0 = ringEl();
    const el = label && find(label);
    if (!el) { r0.style.display = "none"; return; }
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
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
  // Nothing runs before the demo database is open and the app has drawn a control.
  let queue = ready.then(() => until(() => document.querySelector("button"), 15000), () => {});
  window.addEventListener("message", (e) => {
    const d = e.data || {};
    if (d.docsTheme) document.documentElement.dataset.theme = d.docsTheme;
    if (d.docsMode) document.documentElement.dataset.mode = d.docsMode;
    if (Array.isArray(d.docsDo)) queue = queue.then(async () => { for (const s of d.docsDo) { await act(s); await new Promise((r) => setTimeout(r, 250)); } });
    if ("docsRing" in d) queue = queue.then(() => until(() => !d.docsRing || find(d.docsRing), 4000)).then(() => requestAnimationFrame(() => show(d.docsRing)));
  });
})();
