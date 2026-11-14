#!/usr/bin/env node
/**
 * Builds the user help site from docs/using/*.md into docs/.site/ (not
 * committed). It reuses the app's own CSS, so every one of the app's themes is
 * a docs theme too; docs/plans/current/docs-map/design-set.md lists the only
 * elements it may use. Frozen views of the real app come from
 * scripts/capture-docs-views.mjs into docs/using/views/ and are copied in.
 *
 *   node scripts/build-user-docs.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";

import { frontMatter } from "./lib/doc-freshness.mjs";
import { ROOT } from "./lib/repo-stats.mjs";
import {
  decorate,
  fasterWay,
  listItems,
  noteSteps,
  plainText,
  readMinutes,
  relatedStems,
  sections,
  slug,
  stripFrontMatter,
  stuckToDetails,
  tableFacts,
} from "./lib/user-docs.mjs";

const SRC = path.join(ROOT, "docs/using");
const OUT = path.join(ROOT, "docs/.site");
const VIEWS = path.join(SRC, "views");
const manifest = fs.existsSync(path.join(VIEWS, "index.json"))
  ? JSON.parse(fs.readFileSync(path.join(VIEWS, "index.json"), "utf8"))
  : { size: null, views: {} };
const APP = path.join(ROOT, "apps/web/src/app");
const STYLES = ["base.css", "states.css", "cards.css", "markdown.css"];

const GROUPS = [
  ["Start here", ["getting-started", "desktop", "workspaces", "workspace-folder", "projects", "dashboard", "settings", "account"]],
  ["Your research", ["papers", "reader", "reading-lists", "review-queue", "citations-and-overleaf", "search", "graph", "tags"]],
  ["Writing", ["notes", "ink", "paste", "wiki", "logbook", "reports", "experiments", "plan"]],
  ["Working together", ["sharing", "collaborative-editing", "organisations", "supervision", "git", "sync"]],
  ["App and data", ["integrations", "extensions", "ai-assistant", "release-notices"]],
];

const esc = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The picker shows the app's own theme names, in the app's order.
function themeOptions() {
  const source = fs.readFileSync(path.join(ROOT, "apps/web/src/lib/theme/theme.ts"), "utf8");
  return ["LIGHT", "DARK"].map((mode) => {
    const block = source.match(new RegExp(`${mode}_THEME_OPTIONS[^=]*=\\s*\\[([\\s\\S]*?)\\];`))[1];
    return [mode === "LIGHT" ? "Light" : "Dark", [...block.matchAll(/id: "([^"]+)", label: "([^"]+)"/g)].map((m) => [m[1], m[2]])];
  });
}

// Theme files in the app's cascade order (themes/index.css), then the shared styles.
function appCss() {
  const index = fs.readFileSync(path.join(APP, "themes/index.css"), "utf8");
  const themes = [...index.matchAll(/@import "\.\/([^"]+)"/g)].map((m) => `themes/${m[1]}`);
  return [...themes, ...STYLES.map((file) => `styles/${file}`)];
}

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

const pages = fs
  .readdirSync(SRC)
  .filter((name) => name.endsWith(".md"))
  .sort()
  .map((name) => {
    const stem = name.slice(0, -3);
    const raw = fs.readFileSync(path.join(SRC, name), "utf8");
    const html = decorate(marked.parse(stripFrontMatter(raw)), stem, (key) => manifest.views[key] ?? null);
    const title = plainText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? stem);
    const intro = plainText(html.match(/<p>([\s\S]*?)<\/p>/)?.[1] ?? "");
    const tasks = [...html.matchAll(/<h3 id="([^"]+)">([\s\S]*?)<\/h3>/g)].map((m) => [m[1], plainText(m[2])]);
    return { stem, html, title, intro, tasks, checked: frontMatter(raw)?.checked ?? "" };
  });

const byStem = new Map(pages.map((page) => [page.stem, page]));
const listed = new Set(GROUPS.flatMap(([, stems]) => stems));
const groups = [...GROUPS, ["More", pages.map((p) => p.stem).filter((stem) => !listed.has(stem))]]
  .map(([name, stems]) => [name, stems.filter((stem) => byStem.has(stem))])
  .filter(([, stems]) => stems.length > 0);
const themes = themeOptions();
const themeIds = themes.flatMap(([, list]) => list.map(([id]) => id));
const css = appCss();


const ISSUES = "https://github.com/Satwik-Miyyapuram/weaveforge/issues/new";

function shell({ stem, title, main, home = false }) {
  const tree = groups
    .map(([name, stems]) => {
      const links = stems.map((s) => `<a href="${s}.html"${s === stem ? ' aria-current="page"' : ""}>${esc(byStem.get(s).title)}</a>`);
      return `<p class="docs-hand">${name}</p>\n${links.join("\n")}`;
    })
    .join("\n");
  const picker = themes
    .map(([label, list]) => `<optgroup label="${label}">${list.map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join("")}</optgroup>`)
    .join("");
  // Set the theme before first paint, so a dark reader never sees a light flash.
  const noFlash = `try{var t=localStorage.getItem("wf-docs-theme");document.documentElement.dataset.theme=${JSON.stringify(themeIds)}.indexOf(t)>=0?t:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch(e){}`;
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · WeaveForge help</title>
<script>${noFlash}</script>
${css.map((file) => `<link rel="stylesheet" href="app/${file}">`).join("\n")}
<link rel="stylesheet" href="site.css">
</head>
<body class="docs${home ? " docs-home" : ""}" data-page="${stem}">
<header class="docs-wrap docs-top">
<button class="docs-menu" aria-label="All topics" aria-expanded="false" data-docs-menu><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
<a class="docs-brand" href="index.html">WeaveForge <i class="docs-hand">help notebook</i></a>
<nav class="docs-topnav"><a href="getting-started.html">Start here</a><a href="index.html#stages">I want to…</a></nav>
<button class="docs-search docs-sketchy" data-docs-search>Look something up <kbd>Ctrl K</kbd></button>
<select class="wf-select docs-theme" data-docs-theme aria-label="Theme">${picker}</select>
</header>
<div class="docs-backdrop" data-docs-backdrop hidden></div>
<nav class="docs-tree docs-sheet" aria-label="All topics">
${tree}
</nav>
<main class="docs-wrap${home ? "" : " docs-page"}">
${main}
</main>
<footer class="docs-foot"><div class="docs-wrap"><a href="index.html#stages">All topics</a><a href="release-notices.html">What's new</a><a href="${ISSUES}">Report a problem with the docs</a></div></footer>
<div class="docs-palette" data-docs-palette hidden>
<div class="docs-palette-box"><input data-docs-palette-input placeholder="Search help" aria-label="Search help"><ul data-docs-palette-list></ul></div>
</div>
<script src="search-index.js"></script>
<script src="site.js"></script>
</body>
</html>
`;
}

const card = (title, body) => `<div class="docs-card"><b class="docs-hand">${title}</b>${body}</div>`;

// The notebook's right margin: a hand note, the short cards, and "Did this help?".
function margin(page, parts, viewed) {
  const how = parts.find((p) => p.id === "how-to");
  const psst = viewed
    ? `<p class="docs-note">psst, click a step and the app below shows you where.</p>`
    : `<p class="docs-note">psst, ${page.tasks.length ? "pick a how-to:" : "it's a short one."}</p>`;
  const toc = !viewed && how && page.tasks.length ? `<nav class="docs-toc" aria-label="On this page">${page.tasks.map(([id, text]) => `<a href="#${id}">${esc(text)}</a>`).join("")}</nav>` : "";
  const faster = fasterWay(plainText(page.html));
  const known = parts.find((p) => p.id === "good-to-know");
  const facts = known
    ? listItems(known.body).slice(0, 4)
    : tableFacts(parts.find((p) => p.id === "reference")?.body ?? "", 4).map(([k, v]) => `${esc(k)}: ${esc(v)}`);
  const vote = `<div class="docs-note docs-note--tilt docs-vote" data-docs-vote>Did this help? <button class="docs-sketchy" data-vote="yes">yes</button><button class="docs-sketchy" data-vote="no">not really</button>
<span data-vote-yes hidden>Thanks! Glad it did.</span><span data-vote-no hidden>Sorry. <a href="${ISSUES}">Tell us what was missing</a>.</span></div>`;
  return `<aside class="docs-margin">
${psst}${toc}
${faster ? card("Faster way", `<p>${esc(faster)}</p>`) : ""}
${facts.length ? card("Good to know", `<ul>${facts.map((f) => `<li>${f}</li>`).join("")}</ul>`) : ""}
${vote}
</aside>`;
}

// A frozen view of the app at its captured size, scaled to the figure by site.js.
function viewFrame(src, title, extra = "") {
  const [w, h] = manifest.size;
  return `<figure class="docs-taped docs-figure"${extra}><div class="docs-view-frame" style="aspect-ratio:${w}/${h}"><iframe src="${src}" title="${esc(title)}" tabindex="-1" loading="lazy" style="width:${w}px;height:${h}px"></iframe></div>`;
}

// After each how-to list with views, a figure that shows the active step's view.
function stepFigures(body) {
  return body.replace(/<ol class="docs-steps"[\s\S]*?<\/ol>/g, (ol) => {
    const first = ol.match(/data-view="([^"]+)"/)?.[1];
    return first ? `${ol}\n${viewFrame(first, "WeaveForge", " data-docs-steps-view")}<figcaption data-docs-view-caption></figcaption></figure>\n` : ol;
  });
}

function pageHtml(page) {
  const [groupName, group] = groups.find(([, stems]) => stems.includes(page.stem));
  const { head, parts } = sections(page.html);
  const viewed = page.html.includes("data-view=");
  const minutes = readMinutes(plainText(page.html));
  const chips = [
    page.tasks.length ? `${page.tasks.length} how-to${page.tasks.length === 1 ? "" : "s"}` : "",
    `${minutes} min read`,
    page.checked ? `Checked ${page.checked}` : "",
  ].filter(Boolean);
  const top = head
    .replace(/<p>/, '<p class="docs-promise">')
    .replace(/(<p class="docs-promise">[\s\S]*?<\/p>)/, `$1\n<p class="docs-chips">${chips.map((c) => `<span>${c}</span>`).join("")}</p>`);
  const heroView = manifest.views[`${page.stem}/hero`];
  const hero = heroView ? `${viewFrame(`views/${heroView}`, `${page.title} in WeaveForge`)}</figure>\n` : "";
  const body = parts
    .filter((p) => p.id !== "related" && p.id !== "good-to-know")
    .map((p) => {
      const inner = p.id === "how-to" ? stepFigures(noteSteps(p.body)) : p.id === "stuck" ? stuckToDetails(p.body) : p.body;
      return `<h2 id="${p.id}">${esc(p.title)}</h2>\n${inner}`;
    })
    .join("");
  const related = relatedStems(parts.find((p) => p.id === "related")?.body ?? "").filter((s) => byStem.has(s) && s !== page.stem);
  const next = (related.length ? related : group.filter((s) => s !== page.stem)).slice(0, 4);
  const crumb = `<p class="docs-crumb"><a href="index.html">Notebook</a> › <a href="index.html#${slug(groupName)}">${groupName}</a></p>\n`;
  const upNext = next.length
    ? `<h2 id="up-next">Up next</h2>\n<nav class="docs-next" aria-label="Up next">${next.map((s) => `<a class="docs-sketchy" href="${s}.html">→ ${esc(byStem.get(s).title)}</a>`).join("")}</nav>`
    : "";
  const main = `<article class="docs-sheet docs-md markdown">
${crumb}${top}${hero}${body}${upNext}
</article>
${margin(page, parts, viewed)}`;
  return shell({ stem: page.stem, title: page.title, main });
}

// What each part of the notebook is for, in the reader's words, plus a margin note.
const STAGE_LINES = {
  "Start here": "do this first",
  "Your research": "most people's first stop",
  Writing: "think, write, log",
  "Working together": "share with your group",
  "App and data": "connect and extend",
};

function stage([name, stems], i) {
  const rows = stems.map((s) => {
    const page = byStem.get(s);
    const n = page.tasks.length ? `<small>${page.tasks.length} how-to${page.tasks.length === 1 ? "" : "s"}</small>` : "";
    return `<li><a href="${s}.html">${esc(page.title)}</a>${n}</li>`;
  });
  const note = STAGE_LINES[name] ? ` <small class="docs-hand">${STAGE_LINES[name]}</small>` : "";
  return `<section class="docs-sheet docs-stage${i % 2 ? " docs-tilt-r" : " docs-tilt-l"}" id="${slug(name)}">\n<h2>${name}${note}</h2>\n<ul>${rows.join("")}</ul>\n</section>`;
}

const DOORS = [
  ["getting-started", "Start from zero"],
  ["sync", "Move between devices"],
  ["search", "Find anything"],
  ["release-notices", "What changed"],
];

function homeHtml() {
  const howtos = pages.reduce((n, p) => n + p.tasks.length, 0);
  const hero = `<section class="docs-hero">
<div>
<p class="docs-hand docs-kicker">Day 1 of your PhD, probably.</p>
<h1>Your research, <span class="docs-mark">one page at a time.</span></h1>
<p class="docs-promise">The notebook we wish we had: how to read, write and keep track of your research in WeaveForge, with notes in the margins.</p>
</div>
<div class="docs-pic">
<div class="docs-taped docs-index-card">
<p class="docs-hand">How this notebook works</p>
<ol class="docs-steps docs-steps--static">
<li class="docs-step">Pick a sheet below, or press <kbd>Ctrl K</kbd>.</li>
<li class="docs-step">Keep WeaveForge open and follow the numbered steps.</li>
<li class="docs-step">Stuck? Open the questions at the bottom of the page.</li>
</ol>
</div>
<svg class="docs-arrow" viewBox="0 0 60 60" width="60" height="60" aria-hidden="true"><path d="M40 4 C50 30 30 46 24 56" /><path d="M16 48 L24 56 L30 46" /></svg>
<span class="docs-note docs-pic-note">${pages.length} pages, ${howtos} how-tos</span>
</div>
</section>`;
  const doors = DOORS.filter(([s]) => byStem.has(s)).map(([s, text]) => `<a class="docs-sketchy" href="${s}.html">${text}</a>`);
  const main = `${hero}
<h2 class="docs-sec" id="stages">I want to… <small class="docs-hand">(pick where you are)</small></h2>
<div class="docs-stages">
${groups.map(stage).join("\n")}
</div>
<h2 class="docs-sec">Other ways in</h2>
<nav class="docs-doors" aria-label="Other ways in">${doors.join("")}</nav>`;
  return shell({ stem: "index", title: "Home", main, home: true });
}

// One entry per page and per h2/h3, for the Ctrl K palette.
function searchIndex() {
  const entries = [];
  for (const page of pages) {
    entries.push({ title: page.title, href: `${page.stem}.html`, section: "", text: page.intro.slice(0, 200) });
    for (const m of page.html.matchAll(/<h[23] id="([^"]+)">([\s\S]*?)<\/h[23]>([\s\S]*?)(?=<h[1-3][ >]|$)/g)) {
      entries.push({ title: plainText(m[2]), href: `${page.stem}.html#${m[1]}`, section: page.title, text: plainText(m[3]).slice(0, 200) });
    }
  }
  return `window.DOCS_INDEX = ${JSON.stringify(entries)};\n`;
}

fs.mkdirSync(OUT, { recursive: true });
for (const file of css) copy(path.join(APP, file), path.join(OUT, "app", file));
for (const file of ["site.css", "site.js"]) copy(path.join(ROOT, "scripts/user-docs", file), path.join(OUT, file));
if (fs.existsSync(VIEWS)) fs.cpSync(VIEWS, path.join(OUT, "views"), { recursive: true });
for (const page of pages) fs.writeFileSync(path.join(OUT, `${page.stem}.html`), pageHtml(page));
fs.writeFileSync(path.join(OUT, "index.html"), homeHtml());
fs.writeFileSync(path.join(OUT, "search-index.js"), searchIndex());
console.log(`user-docs: ${pages.length} pages and the home page in ${path.relative(ROOT, OUT)}`);
