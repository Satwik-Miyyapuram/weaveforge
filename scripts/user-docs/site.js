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
  // demo app: it opens where the how-to starts, does each step's **bold** control up
  // to the active step, and rings the active step's control. Under the title, the
  // same app shows the page's screen. Readers watch it; it takes no input.
  // The page runs ONE app: a single frame that moves to the figure most in view and
  // switches screens inside the app, so the app and its database load once per page.
  const steps = [...document.querySelectorAll("ol.docs-steps:not(.docs-steps--static) > li.docs-step")];
  const boxes = [...document.querySelectorAll(".docs-view-frame")];
  const views = new Map(); // box -> { ol, src, start, title, at: step it shows, want: step asked for }
  const demo = document.createElement("iframe");
  demo.tabIndex = -1;
  let cur = null;   // the box the demo sits in
  let ticket = 0;   // the switch the demo is busy with; older answers are ignored
  let booted = false;

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
  function send(msg) {
    if (demo.contentWindow) demo.contentWindow.postMessage(msg, "*");
  }
  function busy(box) {
    views.get(box).at = 0;
    box.dataset.demo = "loading";
    ticket++;
  }
  // (Re)load the app at the box's screen in the docs theme, from the same demo data.
  function reload(box) {
    busy(box);
    booted = false;
    const url = new URL(views.get(box).src);
    url.searchParams.set("docsTheme", theme);
    url.searchParams.set("docsMode", mode());
    demo.src = url.href;
  }
  // Show the box's screen in the running app: no new page, no new database.
  function switchTo(box) {
    busy(box);
    const v = views.get(box);
    send({ docsStart: ticket, docsGo: v.src, docsDo: v.start });
  }
  // moveBefore keeps the frame running; browsers without it reload it in its new place.
  function moveTo(box) {
    if (cur && cur !== box) cur.dataset.demo = "idle";
    const keeps = typeof box.moveBefore === "function" && demo.isConnected;
    if (keeps) box.moveBefore(demo, null); else box.appendChild(demo);
    cur = box;
    title(box);
    scale(box);
    if (keeps && booted) switchTo(box); else reload(box);
  }
  const seen = new Map(); // box -> how much of it is on screen
  let settle;
  const near = new IntersectionObserver(entries => {
    entries.forEach(e => seen.set(e.target, e.isIntersecting ? e.intersectionRatio : 0));
    clearTimeout(settle);
    settle = setTimeout(pick, 250);
  }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
  function pick() {
    let best = null, most = 0;
    seen.forEach((r, b) => { if (r > most) { best = b; most = r; } });
    if (best && best !== cur) moveTo(best); // none on screen: the demo stays where it is
  }
  // The app says when it has drawn (true), and when it has done a switch (its ticket).
  window.addEventListener("message", e => {
    if (e.source !== demo.contentWindow || !cur || !e.data || !("docsReady" in e.data)) return;
    const v = views.get(cur);
    if (e.data.docsReady === true) {
      booted = true;
      send({ docsStart: ticket, docsDo: v.start });
    } else if (e.data.docsReady === ticket) {
      delete cur.dataset.demo;
      v.at = 1;
      go(cur, v.want);
    }
  });
  // Walk the demo forward to step `n`; going back means starting the how-to over.
  function go(box, n) {
    const v = views.get(box);
    v.want = n;
    if (box !== cur || !v.at) return;
    if (!v.ol) return send({ docsRing: null });
    if (n < v.at) return booted ? switchTo(box) : reload(box);
    const lis = [...v.ol.children];
    const todo = lis.slice(v.at - 1, n - 1).flatMap(controls);
    v.at = n;
    const ring = controls(lis[n - 1]);
    send({ docsDo: todo, docsRing: ring[ring.length - 1] || null });
  }
  // The demo keeps a desktop size; scaling it down keeps the layout true at every width.
  function scale(box) {
    demo.style.transform = "scale(" + box.clientWidth / parseFloat(demo.style.width) + ")";
  }
  const fit = new ResizeObserver(entries => entries.forEach(e => { if (e.target === cur) scale(cur); }));
  function title(box) {
    const v = views.get(box);
    const li = v.ol && v.ol.querySelector(":scope > li.is-active");
    demo.title = li ? li.textContent.trim() : v.title;
  }
  boxes.forEach(box => {
    const ph = box.querySelector("iframe");
    const fig = box.closest("figure");
    const howto = fig.parentElement.matches(".docs-howto") ? fig.parentElement : null;
    views.set(box, { ol: howto && howto.querySelector("ol.docs-steps"), src: ph.dataset.src, start: JSON.parse(ph.dataset.docsDo || "[]"), title: ph.title, at: 0, want: 1 });
    if (!demo.style.width) demo.style.cssText = ph.style.cssText;
    ph.remove();
    box.dataset.demo = "idle";
    fit.observe(box);
    near.observe(box);
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
    const box = fig.querySelector(".docs-view-frame");
    const cap = fig.querySelector("[data-docs-view-caption]");
    go(box, Number(li.dataset.step));
    if (box === cur) title(box);
    if (cap) cap.textContent = heading(li) + " · step " + li.dataset.step;
  }
  function refreshViews() {
    if (cur) reload(cur);
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
