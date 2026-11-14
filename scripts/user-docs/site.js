// Docs site behaviour: theme switch, steps and picture, search palette, topics drawer, vote.
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
    refreshShot();
  });

  // Steps: one active step per list (the filled circle); a step with a picture also shows it.
  const steps = [...document.querySelectorAll("ol.docs-steps:not(.docs-steps--static) > li.docs-step")];
  const img = document.querySelector("[data-docs-shot]");
  const cap = document.querySelector("[data-docs-shot-caption]");
  const fig = img && img.closest("figure");
  let current = null;

  function heading(li) {
    const ol = li.closest("ol");
    let p = ol ? ol.previousElementSibling : null;
    while (p && p.tagName !== "H3") p = p.previousElementSibling;
    return p ? p.textContent.trim() : "";
  }
  function mark(li) {
    li.parentElement.querySelectorAll(":scope > li").forEach(s => s.classList.toggle("is-active", s === li));
  }
  function setActive(li) {
    mark(li);
    if (!img || !li.dataset.shot) return;
    current = li;
    img.src = li.dataset.shot + "." + theme + ".png";
    img.alt = li.textContent.trim();
    if (cap) cap.textContent = heading(li) + " · step " + li.dataset.step;
    img.onerror = () => {
      if (!img.src.endsWith(".light.png")) img.src = li.dataset.shot + ".light.png";
      else if (fig) fig.hidden = true;
    };
  }
  function refreshShot() {
    if (current) setActive(current);
  }
  if (img) img.onload = () => { if (fig) fig.hidden = false; };

  steps.forEach(li => li.addEventListener("click", () => setActive(li)));
  document.querySelectorAll("ol.docs-steps:not(.docs-steps--static)").forEach(ol => {
    if (ol.firstElementChild) mark(ol.firstElementChild);
  });
  const shotSteps = steps.filter(li => li.dataset.shot);
  if (shotSteps.length && img) {
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) setActive(e.target); });
      }, { rootMargin: "-35% 0px -55% 0px" });
      shotSteps.forEach(s => io.observe(s));
    }
    setActive(shotSteps[0]);
  }

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
