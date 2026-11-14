// Docs site behaviour: theme switch, step picture, search palette, phone menu.
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

  // Step picture
  const steps = [...document.querySelectorAll("li.docs-step[data-shot]")];
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
  function setActive(li) {
    current = li;
    steps.forEach(s => s.classList.remove("is-active"));
    li.classList.add("is-active");
    if (!img) return;
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

  if (steps.length) {
    steps.forEach(li => li.addEventListener("click", () => setActive(li)));
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) setActive(e.target); });
      }, { rootMargin: "-35% 0px -55% 0px" });
      steps.forEach(s => io.observe(s));
    }
    setActive(steps[0]);
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

  // Phone menu
  const menu = document.querySelector("[data-docs-menu]");
  if (menu) menu.addEventListener("click", () => document.body.classList.toggle("docs-tree-open"));
  document.querySelectorAll(".docs-tree a").forEach(a =>
    a.addEventListener("click", () => document.body.classList.remove("docs-tree-open")));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") document.body.classList.remove("docs-tree-open");
  });
})();
