// Docs site behaviour: theme switch, steps and the demo app, search palette, topics drawer, vote.
// The generator also inlines a 1-line head script for no-flash; this file does not touch it.
(function () {
  "use strict";

  const KEY = "wf-docs-theme";
  const sel = document.querySelector("select[data-docs-theme]");

  function load(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function save(k, v) {
    try { localStorage.setItem(k, v); } catch (e) { /* storage may be blocked */ }
  }
  function ids() {
    return sel ? [...sel.options].map(o => o.value) : [];
  }
  function pickTheme() {
    const stored = load(KEY);
    if (stored && ids().includes(stored)) return stored;
    return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  let theme = pickTheme();
  function applyTheme(t) {
    theme = t;
    document.documentElement.dataset.theme = t;
    if (sel) sel.value = t;
  }
  applyTheme(theme);
  if (sel) sel.addEventListener("change", () => {
    applyTheme(sel.value);
    save(KEY, sel.value);
    refreshViews();
  });

  // Steps: one active step per list (the filled circle). Beside each how-to sits the
  // demo app: it opens where the page starts, does each step's **bold** control up
  // to the active step, and rings the active step's control. Under the title, the
  // same app shows the page's screen. Readers watch it; it takes no input.
  const steps = [...document.querySelectorAll("ol.docs-steps:not(.docs-steps--static) > li.docs-step")];
  const frames = [...document.querySelectorAll(".docs-view-frame iframe")];
  const live = new Map(); // iframe -> { ol, off, loaded, at: step it shows, want: step asked for }

  function mode() {
    const opt = sel && sel.selectedOptions[0];
    const group = opt && opt.parentElement;
    return group && group.label === "Dark" ? "dark" : "light";
  }
  // "**Settings → Org**" means click Settings, then Org.
  function controls(li) {
    const bold = li && li.querySelector("strong");
    return bold ? bold.textContent.split("→").map(s => s.trim()).filter(Boolean) : [];
  }
  function send(frame, msg) {
    if (frame.contentWindow) frame.contentWindow.postMessage(msg, "*");
  }
  // (Re)load the demo in the docs theme; every load starts from the same demo data.
  function reload(frame) {
    const url = new URL(frame.dataset.src);
    url.searchParams.set("docsTheme", theme);
    url.searchParams.set("docsMode", mode());
    const s = live.get(frame);
    s.off = false;
    s.loaded = false;
    s.at = 0;
    frame.src = url.href;
  }
  // Each demo runs its own database, so only the ones near the screen run at all.
  function unload(frame) {
    const s = live.get(frame);
    s.off = true;
    s.loaded = false;
    frame.src = "about:blank";
  }
  const near = new IntersectionObserver(entries => entries.forEach(e => {
    const frame = e.target.querySelector("iframe");
    if (e.isIntersecting && live.get(frame).off) reload(frame);
    else if (!e.isIntersecting && !live.get(frame).off) unload(frame);
  }), { rootMargin: "300px 0px" });
  // Walk the demo forward to step `n`; going back means starting over.
  function go(frame, n) {
    const s = live.get(frame);
    s.want = n;
    if (!s.loaded) return;
    if (!s.ol) return send(frame, { docsRing: null });
    if (n < s.at) return reload(frame);
    const lis = [...s.ol.children];
    const todo = lis.slice(Math.max(s.at, 1) - 1, n - 1).flatMap(controls);
    s.at = n;
    const ring = controls(lis[n - 1]);
    send(frame, { docsDo: todo, docsRing: ring[ring.length - 1] || null });
  }
  // The demo keeps a desktop size; scaling it down keeps the layout true at every width.
  const fit = new ResizeObserver(entries => entries.forEach(e => {
    const frame = e.target.querySelector("iframe");
    frame.style.transform = "scale(" + e.contentRect.width / parseFloat(frame.style.width) + ")";
  }));
  frames.forEach(frame => {
    const fig = frame.closest("figure");
    const howto = fig.parentElement.matches(".docs-howto") ? fig.parentElement : null;
    live.set(frame, { ol: howto && howto.querySelector("ol.docs-steps"), off: true, loaded: false, at: 0, want: 1 });
    fit.observe(frame.parentElement);
    near.observe(frame.parentElement);
    frame.addEventListener("load", () => {
      const s = live.get(frame);
      if (s.off || s.loaded) return;
      s.loaded = true;
      send(frame, { docsDo: JSON.parse(frame.dataset.docsDo || "[]") });
      s.at = 1;
      go(frame, s.want);
    });
  });

  function heading(li) {
    const ol = li.closest("ol");
    const box = ol && ol.parentElement.matches(".docs-howto") ? ol.parentElement : ol;
    let p = box ? box.previousElementSibling : null;
    while (p && p.tagName !== "H3") p = p.previousElementSibling;
    return p ? p.textContent.trim() : "";
  }
  function setActive(li) {
    const ol = li.parentElement;
    ol.querySelectorAll(":scope > li").forEach(s => s.classList.toggle("is-active", s === li));
    const fig = ol.nextElementSibling;
    if (!fig || !fig.matches("figure[data-docs-steps-view]")) return;
    const frame = fig.querySelector("iframe");
    const cap = fig.querySelector("[data-docs-view-caption]");
    go(frame, Number(li.dataset.step));
    frame.title = li.textContent.trim();
    if (cap) cap.textContent = heading(li) + " · step " + li.dataset.step;
  }
  function refreshViews() {
    frames.forEach(frame => { if (!live.get(frame).off) reload(frame); });
  }

  steps.forEach(li => li.addEventListener("click", () => setActive(li)));
  document.querySelectorAll("ol.docs-steps:not(.docs-steps--static)").forEach(ol => {
    if (ol.firstElementChild) setActive(ol.firstElementChild);
  });

  // Search palette
  const box = document.querySelector("[data-docs-palette]");
  const input = document.querySelector("[data-docs-palette-input]");
  const list = document.querySelector("[data-docs-palette-list]");
  const data = window.DOCS_INDEX || [];
  const lc = v => (v || "").toLowerCase();

  function render(q) {
    const words = lc(q).split(/\s+/).filter(Boolean);
    let hits;
    if (!words.length) {
      hits = data.slice(0, 12);
    } else {
      hits = data.map(e => {
        const t = lc(e.title), s = lc(e.section), x = lc(e.text);
        let score = 0;
        for (const w of words) {
          let m = 0;
          if (t.includes(w)) m += 3;
          if (s.includes(w)) m += 2;
          if (x.includes(w)) m += 1;
          if (!m) return null;
          score += m;
        }
        return { e, score };
      }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 12).map(r => r.e);
    }
    list.textContent = "";
    hits.forEach((e, i) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = e.href;
      a.textContent = e.title;
      const small = document.createElement("small");
      small.textContent = e.section;
      a.appendChild(small);
      li.appendChild(a);
      if (i === 0) li.classList.add("is-active");
      list.appendChild(li);
    });
  }
  function open() {
    box.hidden = false;
    input.value = "";
    render("");
    input.focus();
  }
  function close() {
    box.hidden = true;
  }
  function move(d) {
    const lis = [...list.querySelectorAll("li")];
    if (!lis.length) return;
    let i = lis.findIndex(li => li.classList.contains("is-active"));
    lis.forEach(li => li.classList.remove("is-active"));
    i = Math.min(Math.max(i + d, 0), lis.length - 1);
    lis[i].classList.add("is-active");
    lis[i].scrollIntoView({ block: "nearest" });
  }

  if (box && input && list) {
    input.addEventListener("input", () => render(input.value));
    input.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { move(1); e.preventDefault(); }
      else if (e.key === "ArrowUp") { move(-1); e.preventDefault(); }
      else if (e.key === "Enter") {
        const a = list.querySelector("li.is-active a");
        if (a) { e.preventDefault(); location.href = a.href; }
      }
    });
    box.addEventListener("click", e => { if (e.target === box) close(); });
    document.querySelectorAll("[data-docs-search]").forEach(b => b.addEventListener("click", open));
    document.addEventListener("keydown", e => {
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (box.hidden) open(); else close();
      } else if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        e.preventDefault();
        open();
      } else if (e.key === "Escape") {
        close();
      }
    });
  }

  // Topics drawer: the menu button opens it at every width; backdrop, Escape or a link closes it.
  const menu = document.querySelector("[data-docs-menu]");
  const backdrop = document.querySelector("[data-docs-backdrop]");
  function drawer(open) {
    document.body.classList.toggle("docs-tree-open", open);
    if (backdrop) backdrop.hidden = !open;
    if (menu) menu.setAttribute("aria-expanded", String(open));
  }
  if (menu) menu.addEventListener("click", () => drawer(!document.body.classList.contains("docs-tree-open")));
  if (backdrop) backdrop.addEventListener("click", () => drawer(false));
  document.querySelectorAll(".docs-tree a").forEach(a => a.addEventListener("click", () => drawer(false)));
  document.addEventListener("keydown", e => { if (e.key === "Escape") drawer(false); });

  // "Did this help?": answered on this device only, nothing is sent.
  const vote = document.querySelector("[data-docs-vote]");
  if (vote) {
    const page = document.body.dataset.page;
    const show = v => {
      vote.querySelectorAll("button").forEach(b => { b.hidden = true; });
      const msg = vote.querySelector("[data-vote-" + v + "]");
      if (msg) msg.hidden = false;
    };
    const was = load("wf-docs-vote:" + page);
    if (was === "yes" || was === "no") show(was);
    vote.querySelectorAll("button[data-vote]").forEach(b => b.addEventListener("click", () => {
      save("wf-docs-vote:" + page, b.dataset.vote);
      show(b.dataset.vote);
    }));
  }
})();
