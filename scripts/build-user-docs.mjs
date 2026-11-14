#!/usr/bin/env node
/**
 * Builds the user help site from docs/using/*.md into docs/.site/ (not
 * committed). It reuses the app's own CSS, so every one of the app's themes is
 * a docs theme too; docs/plans/current/docs-map/design-set.md lists the only
 * elements it may use. Screenshots come from scripts/capture-docs-shots.mjs and
 * are kept between builds.
 *
 *   node scripts/build-user-docs.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";

import { frontMatter } from "./lib/doc-freshness.mjs";
import { ROOT } from "./lib/repo-stats.mjs";
import { decorate, plainText, slug, stripFrontMatter } from "./lib/user-docs.mjs";

const SRC = path.join(ROOT, "docs/using");
const OUT = path.join(ROOT, "docs/.site");
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
    const hasShot = (key) => fs.existsSync(path.join(OUT, "shots", `${key}.light.png`));
    const html = decorate(marked.parse(stripFrontMatter(raw)), stem, hasShot);
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

// A tile shows the page's first sentence, cut at a word if it runs long.
const blurb = (text) => {
  const sentence = text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
  return sentence.length <= 140 ? sentence : `${sentence.slice(0, 140).replace(/\s+\S*$/, "")}…`;
};
const tile = (page) => `<a class="card docs-tile" href="${page.stem}.html"><b>${esc(page.title)}</b><span>${esc(blurb(page.intro))}</span></a>`;

function shell({ stem, title, main, shots, home = false }) {
  const tree = groups
    .map(([name, stems]) => {
      const links = stems.map((s) => `<a class="wf-nav" href="${s}.html"${s === stem ? ' aria-current="page"' : ""}>${esc(byStem.get(s).title)}</a>`);
      return `<p class="docs-tree-group">${name}</p>\n${links.join("\n")}`;
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
<body class="docs${shots ? "" : " docs-noshots"}${home ? " docs-home" : ""}" data-page="${stem}">
<header class="docs-top">
<button class="wf-btn wf-ghost wf-icon docs-menu" aria-label="Topics" data-docs-menu><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
<a class="docs-brand" href="index.html">WeaveForge help</a>
<button class="wf-btn wf-ghost docs-search-btn" data-docs-search>Search <kbd>Ctrl K</kbd></button>
<select class="wf-select docs-theme" data-docs-theme aria-label="Theme">${picker}</select>
</header>
<div class="docs-shell">
<nav class="docs-tree" aria-label="Topics">
${tree}
</nav>
<main class="docs-page">
${main}
</main>
${home ? "" : aside(stem, shots)}
</div>
<div class="docs-palette" data-docs-palette hidden>
<div class="card docs-palette-box"><input class="wf-input" data-docs-palette-input placeholder="Search help" aria-label="Search help"><ul data-docs-palette-list></ul></div>
</div>
<script src="search-index.js"></script>
<script src="site.js"></script>
</body>
</html>
`;
}

// The margin beside a page: the step picture, then notes in the notebook's margin.
function aside(stem, shots) {
  const toc = byStem.get(stem).tasks.slice(0, 8).map(([id, text]) => `<a href="#${id}">${esc(text)}</a>`);
  const notes = [
    shots ? `<p class="docs-note">Click a step and the picture shows you where.</p>` : "",
    toc.length ? `<nav class="docs-margin-list" aria-label="On this page"><p class="docs-note">On this page</p>${toc.join("")}</nav>` : "",
  ].join("");
  const frame = shots ? `<figure class="card docs-frame"><img data-docs-shot alt=""><figcaption data-docs-shot-caption></figcaption></figure>` : "";
  return `<aside class="docs-shot" aria-live="polite">\n${frame}${notes}\n</aside>`;
}

function pageHtml(page) {
  const [groupName, group] = groups.find(([, stems]) => stems.includes(page.stem));
  const stamp = page.checked ? `\n<p class="docs-stamp"><span class="wf-chip">Checked ${page.checked}</span></p>` : "";
  const crumb = `<p class="docs-crumb"><a href="index.html">Notebook</a> › <a href="index.html#${slug(groupName)}">${groupName}</a></p>\n`;
  const article = crumb + page.html.replace(/(<\/h1>)/, `$1${stamp}`);
  const related = group.filter((stem) => stem !== page.stem).slice(0, 3).map((stem) => tile(byStem.get(stem)));
  const main = `<article class="docs-md markdown docs-sheet">\n${article}\n<h2 id="up-next">Up next</h2>\n<nav class="docs-related" aria-label="Related">${related.join("")}</nav>\n</article>`;
  return shell({ stem: page.stem, title: page.title, main, shots: page.html.includes("data-shot=") });
}

// What each part of the notebook is for, in the reader's words.
const STAGE_LINES = {
  "Start here": "Set up and find your way",
  "Your research": "Collect and read papers",
  Writing: "Think, write and log the work",
  "Working together": "Share with your group",
  "App and data": "Connect and extend",
};

// A stage sheet lists each page as a task, with the page's first how-tos under it.
function stage([name, stems]) {
  const rows = stems.map((s) => {
    const page = byStem.get(s);
    const sub = page.tasks.slice(0, 2).map(([id, text]) => `<a href="${s}.html#${id}">${esc(text)}</a>`).join("");
    return `<li><a class="docs-task" href="${s}.html">${esc(page.title)}</a>${sub ? `<span class="docs-subtasks">${sub}</span>` : ""}</li>`;
  });
  const line = STAGE_LINES[name] ? `<p class="docs-note">${STAGE_LINES[name]}</p>` : "";
  return `<section class="card docs-sheet docs-stage" id="${slug(name)}">\n<h3>${name}</h3>${line}\n<ul class="docs-checklist">${rows.join("")}</ul>\n</section>`;
}

const DOORS = [
  ["getting-started", "Start from zero", "Install, sign in and make your first project."],
  ["sync", "Move between devices", "Keep laptop, web and phone in step."],
  ["release-notices", "What changed", "Notices about new versions."],
];

function homeHtml() {
  const hero = `<section class="docs-hero">
<div class="docs-hero-text">
<p class="docs-kicker">WeaveForge help notebook</p>
<h1>Your research, one page at a time.</h1>
<p>Each page is one part of WeaveForge, written as short how-tos you can follow with the app open beside you.</p>
<p class="docs-hero-actions"><a class="wf-btn wf-primary" href="getting-started.html">Start here</a><button class="wf-btn wf-ghost" data-docs-search>Look something up <kbd>Ctrl K</kbd></button></p>
</div>
<div class="docs-hero-margin">
<p class="docs-note">New here? Start with the first sheet and work down.</p>
<p class="docs-note">Press <kbd>/</kbd> anywhere to search every how-to.</p>
<p class="docs-note">The theme menu up top has all ${themeIds.length} app themes.</p>
</div>
</section>`;
  const doors = DOORS.filter(([s]) => byStem.has(s)).map(
    ([s, head, text]) => `<a class="card docs-tile" href="${s}.html"><b>${head}</b><span>${text}</span></a>`,
  );
  const main = `<article class="docs-home-page">
${hero}
<h2 id="stages">I want to… <span class="docs-note">pick where you are</span></h2>
<div class="docs-stages">
${groups.map(stage).join("\n")}
</div>
<h2 id="other-ways-in">Other ways in</h2>
<nav class="docs-related" aria-label="Other ways in">${doors.join("")}</nav>
</article>`;
  return shell({ stem: "index", title: "Home", main, shots: false, home: true });
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
for (const page of pages) fs.writeFileSync(path.join(OUT, `${page.stem}.html`), pageHtml(page));
fs.writeFileSync(path.join(OUT, "index.html"), homeHtml());
fs.writeFileSync(path.join(OUT, "search-index.js"), searchIndex());
console.log(`user-docs: ${pages.length} pages and the home page in ${path.relative(ROOT, OUT)}`);
