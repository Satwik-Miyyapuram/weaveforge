// Renders the map from window.MAP (data.js). The generator only has to emit data.js.
// One page per area. Nothing is re-rendered on a click: folds open in place and the scroll is held still.
const M = window.MAP;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const LAYERS = { ui: "UI", hook: "Hook", service: "Service", bridge: "Bridge", core: "Rust core", storage: "Storage", network: "Network" };
const LEVELS = [["Glance", "one line per flow"], ["Steps", "what you click"], ["Calls", "functions each step runs"], ["Source", "file and line"]];
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const pref = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
               set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

let level = Math.min(4, Math.max(1, +pref.get("map-level", 2) || 2));
let areaId = null;
let localRoot = pref.get("map-local-root", M.localRoot || "");   // your checkout, for "open in editor"
const local = new Map();   // flow id -> level opened by hand on that card

// ---------- small parts ----------
const ghLink = (path, line) => `${M.repo}/blob/${M.ref}/${path}${line ? "#L" + line : ""}`;
function copyBtn(text) {
  const b = h("button", { type: "button", class: "copy", "aria-label": "Copy " + text, onclick: e => {
    e.stopPropagation();   // keep the card click handler out of it
    navigator.clipboard?.writeText(text);
    b.classList.add("ok"); b.textContent = "Copied";
    setTimeout(() => { b.classList.remove("ok"); b.textContent = "Copy"; }, 1000);
  } }, "Copy");
  return b;
}
function srcLinks(path, line) {
  const loc = `${path}${line ? ":" + line : ""}`;
  return h("span", { class: "src" },
    h("a", { href: ghLink(path, line), target: "_blank", rel: "noopener" }, loc),
    copyBtn(loc),
    localRoot ? h("a", { href: `vscode://file/${localRoot}/${path}${line ? ":" + line : ""}`, class: "ed" }, "open in editor") : null);
}
const richText = t => t.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((p, i) => i % 2 === 0 ? p : p.startsWith("`") ? h("code", {}, p.slice(1, -1)) : h("b", {}, p.slice(2, -2)));
// Touch screens say "Tap" where a mouse would say "Click"
function uiHint(ui) {
  const verb = typeof ui === "string" ? "Click" : ui.verb;
  const label = typeof ui === "string" ? ui : ui.label;
  return h("div", { class: "ui-hint" }, (verb === "Click" && matchMedia("(pointer: coarse)").matches ? "Tap" : verb) + " ", h("kbd", { class: "btnlike" }, label));
}
const slug = s => s.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");

// A fold: the content, and the ghost shown in its place while it is folded.
function fold(need, content, ghost) {
  return h("div", { class: "fold", "data-need": need },
    h("div", { class: "pane body" }, h("div", { class: "in" }, content)),
    ghost ? h("div", { class: "pane ghost" }, h("div", { class: "in" }, ghost)) : null);
}
const bars = lens => h("button", { type: "button", class: "bars", "data-up": 1, title: "Unfold", "aria-label": "Show the steps" },
  lens.map((n, i) => h("i", { style: `--w:${Math.min(96, 22 + n / 1.4)}%;--o:${Math.max(.35, 1 - i * .18)}` })));
const strip = hops => {
  const n = hops.length, first = hops[0]?.layer, last = hops[n - 1]?.layer;   // a step can have no calls
  return h("button", { type: "button", class: "strip", "data-up": 1, title: "Show the calls", "aria-label": `Show the ${n} calls` },
    hops.map(c => h("i", { class: `L-${c.layer}`, title: `${LAYERS[c.layer]}: ${c.fn}` })),
    h("span", { class: "strip-label" }, `${n} call${n === 1 ? "" : "s"} · ${LAYERS[first]} → ${LAYERS[last]}`));
};

// ---------- page ----------
function hero(a) {
  return h("section", { class: "hero wrap wide" },
    h("div", {},
      h("p", { class: "eyebrow" }, "weaveforge map / ", a.id),
      h("h1", {}, a.name),
      h("pre", { class: "typed", "aria-label": "how to use it, what code it runs, where it breaks" }),
      h("p", { class: "lead" }, a.journeys ? a.intro || a.blurb : a.blurb)),
    a.journeys ? h("figure", { class: "art", "aria-hidden": "true" },
      h("div", { class: "art-top" }, h("i"), h("i"), h("i"), h("span", {}, a.journeys[0].name)),
      h("ol", { class: "trace" }), h("figcaption", {}, "One click, followed call by call down to the database.")) : null);
}

// How deep each hop sits in the call tree: a hop is one deeper than the hop that calls it (`by`).
function depths(chain) {
  const by = new Map(chain.map(c => [c.n, c.by])), memo = new Map();
  const d = n => memo.has(n) ? memo.get(n) : (memo.set(n, by.get(n) == null || !by.has(by.get(n)) ? 0 : d(by.get(n)) + 1), memo.get(n));
  chain.forEach(c => d(c.n));
  return memo;
}

function hopEl(c, depth, caller) {
  return h("li", { class: `hop L-${c.layer}`, "data-n": c.n, style: `--d:${depth}` },
    h("div", { class: "row" }, h("span", { class: "layer" }, LAYERS[c.layer] || c.layer), h("code", { class: "fn" }, c.fn), copyBtn(c.fn)),
    caller ? h("small", { class: "note" }, "called by ", h("code", {}, caller.fn)) : null,
    c.note ? h("small", { class: "note" }, c.note) : null,
    fold(4, srcLinks(c.path, c.line), h("span", { class: "srcghost" })));
}

function flowEl(a, j) {
  const id = j.id, D = depths(j.chain), byN = new Map(j.chain.map(c => [c.n, c]));
  const order = a.stages.flatMap(s => s.journeys).map(x => a.journeys.find(y => y.id === x)), k = order.indexOf(j);
  const prev = order[k - 1], next = order[k + 1];
  // One step's calls as a tree; its first call names its caller when that caller sits in an earlier step.
  const tree = hops => {
    const base = Math.min(...hops.map(c => D.get(c.n))), shown = new Set(hops.map(c => c.n));
    return hops.map(c => hopEl(c, D.get(c.n) - base, c.by != null && !shown.has(c.by) ? byN.get(c.by) : null));
  };
  return h("article", { class: "flow", id: `f-${id}`, "data-id": id },
    h("header", { class: "fhead" },
      h("h3", {}, h("a", { href: `#/${a.id}/${id}` }, j.name)),
      h("div", { class: "dots", role: "group", "aria-label": "Fold this flow" },
        LEVELS.map(([name], i) => h("button", { type: "button", "data-l": i + 1, title: name, "aria-label": `${name} for this flow` }, String(i + 1)))),
      h("p", { class: "point" }, j.blurb),
      j.outcome ? h("p", { class: "outcome" }, h("b", {}, "You end with: "), j.outcome) : null,
      j.shot ? h("figure", { class: "shot" }, h("img", { src: j.shot.src, alt: j.shot.alt, loading: "lazy" })) : null,
      j.help ? h("p", { class: "guide" }, "User guide: ",
        h("a", { href: ghLink(j.help.path) + (j.help.heading ? "#" + slug(j.help.heading) : ""), target: "_blank", rel: "noopener" },
          j.help.path.split("/").pop() + (j.help.heading ? ` › ${j.help.heading}` : ""))) : null,
      h("p", { class: "checked" }, "Checked against ", h("a", { href: `${M.repo}/tree/${j.checked || M.ref}`, target: "_blank", rel: "noopener" }, h("code", {}, j.checked || M.ref)))),
    fold(2,
      [h("ol", { class: "steps" }, j.steps.map((s, i) => {
        const hops = j.chain.filter(c => !s.hops || s.hops.includes(c.n));
        return h("li", { class: "step" },
          h("span", { class: "num" }, String(i + 1)),
          h("div", {},
            h("h4", {}, s.title),
            h("p", {}, ...richText(s.text)),
            s.ui ? uiHint(s.ui) : null,
            fold(3, h("ol", { class: "chain" }, tree(hops)), strip(hops))));
      })),
      j.debug ? fold(3, h("div", { class: "debug" }, h("strong", {}, "If it breaks"), h("ul", {}, j.debug.map(d => {
        if (typeof d === "string") return h("li", {}, ...richText(d));
        const href = `#/${a.id}/${j.id}?l=4&hop=${d.check}`;
        return h("li", {}, h("b", {}, d.see), " → ",
          h("a", { class: "check", href, onclick: () => { if (location.hash === href) onRoute(); } }, `check call ${d.check}: `, h("code", {}, byN.get(d.check)?.fn ?? "?")));
      })))) : null,
      h("nav", { class: "prevnext", "aria-label": "Other flows" },
        prev ? h("a", { class: "prev", href: `#/${a.id}/${prev.id}` }, "← ", prev.name) : h("span"),
        next ? h("a", { class: "next", href: `#/${a.id}/${next.id}` }, next.name, " →") : h("span"))],
      bars(j.steps.map(s => s.text.length))));
}

function areaPage(a) {
  const parts = [hero(a)];
  if (a.journeys) {
    const body = h("div", { class: "wrap" });
    a.stages.forEach((s, i) => body.append(h("section", { class: "stage" },
      h("h2", {}, h("span", { class: "n" }, String(i + 1).padStart(2, "0")), s.name),
      h("div", { class: "flows" }, s.journeys.map(id => flowEl(a, a.journeys.find(x => x.id === id)))))));
    body.append(h("ul", { class: "legend" }, Object.entries(LAYERS).map(([k, v]) => h("li", { class: `L-${k}` }, h("i"), v))));
    parts.push(body);
  } else {
    parts.push(h("div", { class: "wrap" }, h("div", { class: "soon-card" },
      h("p", {}, a.blurb),
      h("p", { class: "soon-note" }, "Not mapped yet. The user guides below explain how it works."),
      a.docs?.length ? h("ul", { class: "soon-links" }, a.docs.map(d => h("li", {}, h("a", { href: ghLink(d.path), target: "_blank", rel: "noopener" }, d.title)))) : null)));
  }
  return parts;
}

// ---------- folding ----------
function apply() {
  for (const card of $$(".flow")) {
    const lv = Math.max(level, local.get(card.dataset.id) || 0);
    for (const f of $$(".fold", card)) {
      const open = lv >= +f.dataset.need;
      f.classList.toggle("open", open);
      f.querySelector(".body").inert = !open;
      const g = f.querySelector(".ghost"); if (g) g.inert = open;
    }
    $$(".dots button", card).forEach(b => b.classList.toggle("on", +b.dataset.l <= lv));
  }
  $("#levels").style.setProperty("--i", level - 1);
  $$("#levels button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.l === level));
}

// Keep one element still on screen while heights change, so the page never jumps.
function holding(anchor, change) {
  if (!anchor) { change(); return; }
  const top0 = anchor.getBoundingClientRect().top;
  change();
  const end = performance.now() + 450;
  (function tick() {
    const d = anchor.getBoundingClientRect().top - top0;
    if (Math.abs(d) > .5) window.scrollBy(0, d);
    if (performance.now() < end) requestAnimationFrame(tick);
  })();
}
function topCard() {
  const bar = $(".levelbar").getBoundingClientRect().bottom;
  return $$(".flow").find(c => c.getBoundingClientRect().bottom > bar + 8);
}
function setLevel(n) {
  if (n === level && !local.size) return;
  holding(topCard(), () => { level = n; local.clear(); pref.set("map-level", n); apply(); });
}
function setLocal(card, n) {
  holding(card, () => { local.set(card.dataset.id, n); apply(); });
}

// ---------- the moving parts at the top ----------
let timers = [];
function typer(el) {
  const phrases = ["how to use it", "what code it runs", "where it breaks"];
  const pre = "> see ";
  if (still) { el.textContent = pre + phrases[0]; return; }
  let p = 0, i = 0, del = false;
  const caret = h("span", { class: "caret" });
  const step = () => {
    const w = phrases[p];
    i += del ? -1 : 1;
    el.textContent = pre + w.slice(0, i); el.append(caret);
    let wait = del ? 28 : 55;
    if (!del && i === w.length && p === phrases.length - 1) { caret.remove(); return; }   // last phrase stays
    if (!del && i === w.length) { del = true; wait = 1600; }
    else if (del && i === 0) { del = false; p = (p + 1) % phrases.length; wait = 350; }
    timers.push(setTimeout(step, wait));
  };
  step();
}

// The first flow's calls as a small debugger panel: a cursor steps down the tree, call by call, then starts again.
function traceArt(ol, chain) {
  const D = depths(chain), hops = chain.slice(0, 12);
  ol.replaceChildren(...hops.map(c => h("li", { class: `L-${c.layer}`, style: `--d:${Math.min(D.get(c.n), 7)}` },
    h("i"), h("code", {}, c.fn.length > 30 ? c.fn.slice(0, 29) + "\u2026" : c.fn),
    h("small", {}, `${c.path.split("/").pop()}${c.line ? ":" + c.line : ""}`))));
  const rows = [...ol.children];
  if (still) { rows.forEach(r => r.classList.add("seen")); return; }
  let k = 0;
  const tick = () => {
    if (!ol.isConnected) return;
    if (k === rows.length) { rows.forEach(r => r.classList.remove("now")); return; }   // runs once; every row stays seen
    rows.forEach(r => r.classList.remove("now"));
    rows[k].classList.add("seen", "now"); k++;
    timers.push(setTimeout(tick, k === rows.length ? 2200 : 520));
  };
  timers.push(setTimeout(tick, 600));
}

// ---------- routing ----------
function route() {
  const [path, query = ""] = location.hash.replace(/^#/, "").split("?");
  const [, a, j] = path.split("/"), q = new URLSearchParams(query);
  const l = +q.get("l");
  return { area: a || M.areas.find(x => x.journeys).id, flow: j || null,
    l: l >= 1 && l <= 4 ? l : null, hop: +q.get("hop") || null };
}
function showArea(id) {
  const a = M.areas.find(x => x.id === id) || M.areas[0];
  areaId = a.id; local.clear();
  timers.forEach(clearTimeout); timers = [];
  $$("#areas a").forEach(x => x.classList.toggle("on", x.dataset.id === a.id));
  const main = $("#main"); main.replaceChildren(...areaPage(a));
  document.title = `${a.name} · WeaveForge map`;
  $(".levelbar").hidden = !a.journeys;
  typer($(".typed"));
  if (a.journeys) traceArt($(".art .trace"), a.journeys[0].chain);
  apply();
  window.scrollTo(0, 0);
}
function focusFlow(id, hop, l) {
  const card = $(`#f-${CSS.escape(id)}`); if (!card) return;
  local.set(id, l || Math.max(local.get(id) || 0, hop ? 4 : 3, level)); apply();
  card.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  $$(".flow.hit").forEach(x => x.classList.remove("hit")); card.classList.add("hit");
  setTimeout(() => card.classList.remove("hit"), 1800);
  if (hop) { const el = $(`.hop[data-n="${hop}"]`, card); if (el) { el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); } }
}
function onRoute() {
  const r = route();
  if (r.area !== areaId) showArea(r.area);
  if (r.flow) requestAnimationFrame(() => focusFlow(r.flow, r.hop, r.l));
}

// ---------- search (Ctrl+K or /) ----------
const SYN = [["add", "import", "new", "create"], ["delete", "remove", "trash"], ["pdf", "reader", "read"], ["note", "notes", "page"], ["cite", "citation", "reference"], ["sync", "pull", "refresh"]];
const termHit = (hay, t) => hay.includes(t) || SYN.some(g => g.some(w => w.startsWith(t)) && g.some(w => hay.includes(w)));
const IDX = [];
for (const a of M.areas) {
  IDX.push({ label: a.name, sub: a.journeys ? "Area" : "Area · not mapped yet", href: `#/${a.id}` });
  for (const j of a.journeys || []) {
    IDX.push({ label: j.name, sub: `${a.name} · flow`, href: `#/${a.id}/${j.id}` });
    for (const c of j.chain) IDX.push({ label: c.fn, sub: `${j.name} · ${c.path}${c.line ? ":" + c.line : ""}`, href: `#/${a.id}/${j.id}?l=4&hop=${c.n}`, code: 1 });
    j.steps.forEach((s, i) => IDX.push({ label: s.title, sub: `${j.name} · step ${i + 1}`, href: `#/${a.id}/${j.id}?l=2` }));
    if (j.help?.heading) IDX.push({ label: j.help.heading, sub: `${j.name} · guide`, href: `#/${a.id}/${j.id}` });
  }
}
function openSearch() {
  const dlg = $("#search"), inp = $("input", dlg), res = $("ul", dlg);
  let sel = 0, hits = [];
  const go = x => { dlg.close(); if (location.hash === x.href) onRoute(); else location.hash = x.href; };
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    hits = (q ? IDX.filter(x => { const hay = (x.label + " " + x.sub).toLowerCase(); return q.split(/\s+/).every(t => termHit(hay, t)); }) : IDX.filter(x => !x.code)).slice(0, 14);
    res.replaceChildren(...hits.map((x, i) => h("li", { class: i === sel ? "on" : "" },
      h("a", { href: x.href, onclick: e => { e.preventDefault(); go(x); } }, x.code ? h("code", {}, x.label) : x.label, h("small", {}, x.sub)))));
  };
  inp.oninput = () => { sel = 0; draw(); };
  inp.onkeydown = e => {
    if (e.key === "ArrowDown") { sel = Math.min(sel + 1, hits.length - 1); draw(); e.preventDefault(); }
    if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
    if (e.key === "Enter" && hits[sel]) go(hits[sel]);
  };
  inp.value = ""; draw(); dlg.showModal(); inp.focus();
}

// ---------- wiring ----------
$("#areas").append(...M.areas.map(a => h("a", { href: `#/${a.id}`, "data-id": a.id, class: a.journeys ? "" : "soon" }, a.name)));
$("#levels").append(h("span", { class: "thumb", "aria-hidden": "true" }),
  ...LEVELS.map(([name, sub], i) => h("button", { "data-l": i + 1, title: sub }, h("b", {}, String(i + 1)), name)));
$("#levels").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setLevel(+b.dataset.l); });
$("#foot").append(`Generated from ${M.ref}. Every path:line link opens that exact line on GitHub.`);
$("#open-search").addEventListener("click", openSearch);
$("#local-root").value = localRoot;
$("#local-root").addEventListener("change", e => {
  localRoot = e.target.value.trim().replace(/[\\/]+$/, "").replace(/\\/g, "/");
  pref.set("map-local-root", localRoot);
  showArea(areaId); apply();
});

$("#main").addEventListener("click", e => {
  const card = e.target.closest(".flow"); if (!card) return;
  const dot = e.target.closest(".dots button");
  if (dot) { setLocal(card, +dot.dataset.l); return; }
  if (e.target.closest("[data-up]")) {   // a folded ghost: open one level more
    const cur = Math.max(level, local.get(card.dataset.id) || 0);
    setLocal(card, Math.min(4, cur + 1));
  }
});
addEventListener("keydown", e => {
  if ($("#search").open || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || e.key === "/") { e.preventDefault(); openSearch(); return; }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[1-4]$/.test(e.key)) setLevel(+e.key);
});
addEventListener("hashchange", onRoute);
onRoute();
