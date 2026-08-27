#!/usr/bin/env node
/**
 * The parts of the documentation that are facts about the repository.
 *
 * Prose rots silently: nobody notices that "22,000 lines" became 31,000, or
 * that a list of CI gates lost the one added last month, and a reader who
 * checks one figure and finds it wrong stops trusting the page. So anything a
 * document states that the working tree already knows is generated between two
 * markers, and the words around it are not — each page keeps its argument, and
 * the bookkeeping stops being anyone's job.
 *
 *   node scripts/update-docs.mjs            rewrite every generated block
 *   node scripts/update-docs.mjs --check    fail if any is out of date
 *
 * `--check` is what CI runs, so a change that moves one of these facts has to
 * carry the regenerated block with it, the way a lockfile travels with a
 * dependency. Adding a new one is a `BLOCKS` entry plus the two markers in the
 * page: `<!-- generated:<id> -->` and `<!-- /generated:<id> -->`.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CODE = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".css", ".sql"]);

/**
 * One row of the table: where it is, what it is for, and how it is measured.
 *
 * `unit` is either lines of code or a file tally, because for two of these the
 * honest unit is files — a migration is a step in a sequence whether it is four
 * lines or four hundred, and so is a page of documentation.
 */
const AREAS = [
  { dir: "packages/core", unit: "lines", what: "Domain and application logic shared by every surface" },
  { dir: "apps/web", unit: "lines", what: "The app itself: screens, features, API routes, backend wiring" },
  { dir: "apps/desktop", unit: "lines", what: "The Electron shell — what only an installed app can do" },
  { dir: "apps/pitch", unit: "lines", what: "The public site and this documentation" },
  { dir: "python/weaveforge", unit: "lines", what: "The SDK training scripts import" },
  { dir: "python/tests", unit: "lines", what: "Its tests" },
  { dir: "supabase/migrations", unit: "files", what: "The schema, as an ordered sequence" },
  { dir: "docs", unit: "files", what: "Documentation, this page included" },
];

/**
 * The files git is tracking, which is the only definition of "our code" that
 * two machines agree on.
 *
 * Walking the working tree counted whatever happened to be lying in it — a
 * stale build directory, a scratch script, someone's notes — so the same commit
 * measured differently here and on CI, and the check that exists to catch drift
 * became the thing that drifted.
 */
const TRACKED = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\0")
  .filter(Boolean);

function measure({ dir, unit }) {
  let lines = 0;
  let files = 0;
  for (const rel of TRACKED) {
    if (!rel.startsWith(`${dir}/`)) continue;
    const ext = path.extname(rel);
    if (unit === "files") {
      if (ext === ".sql" || ext === ".md") files += 1;
      continue;
    }
    if (!CODE.has(ext)) continue;
    files += 1;
    // Counted the way `wc -l` counts: a trailing newline does not open a line.
    const text = readFileSync(path.join(ROOT, rel), "utf8");
    if (text) lines += text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  }
  return { lines, files };
}
/** Digits a reader can scan, grouped the way they read them. */
const n = (value) => value.toLocaleString("en-US");

function read(rel) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** Every `case "name":` in a dispatch switch, in the order the code lists them. */
function switchCases(rel) {
  return [...read(rel).matchAll(/case "([a-z_]+)":/g)].map((match) => match[1]);
}

function codeMap() {
  const rows = AREAS.map((area) => ({ ...area, ...measure(area) }));
  const counted = rows.filter((row) => row.unit === "lines");
  const totalLines = counted.reduce((sum, row) => sum + row.lines, 0);
  const totalFiles = counted.reduce((sum, row) => sum + row.files, 0);

  return [
    "| Where | Size | What lives there |",
    "| --- | --- | --- |",
    ...rows.map((row) =>
      `| \`${row.dir}\` | ${row.unit === "files" ? `${n(row.files)} files` : `${n(row.lines)} lines`} | ${row.what} |`,
    ),
    "",
    `**${n(totalLines)} lines of code in all**, across ${n(totalFiles)} source files.`,
  ];
}

/**
 * The IPC surface, read from the channel table rather than remembered.
 *
 * A hand-kept list of channels is a list that is wrong the week after somebody
 * adds one, and this is exactly the list a reader uses to decide whether a
 * thing they want is even possible from the renderer.
 */
function desktopIpc() {
  const source = read("apps/desktop/src/channels.ts");
  const channels = [...source.matchAll(/^\s{2}([a-zA-Z]+): "(weaveforge:[a-z-]+)",/gm)]
    .map((match) => ({ name: match[1], channel: match[2] }));
  // Members of the bridge object the preload exposes — one line each, and the
  // count is what the smoke test and the atlas both quote.
  const members = [...read("apps/desktop/src/preload.ts").matchAll(/^ {2}([a-zA-Z]+):/gm)].length;

  return [
    `${n(channels.length)} named channels, reached through the ${n(members)} members of the bridge`,
    "object the preload exposes:",
    "",
    ...channels.map((entry) => `- \`${entry.channel}\` — \`${entry.name}\``),
  ];
}

/** The tools an assistant may call, taken from the dispatch it is checked against. */
function mcpTools() {
  const relay = switchCases("apps/web/src/features/ai-assistant/infrastructure/mcp-browser-relay.ts");
  const reads = relay.filter((tool) => !tool.startsWith("propose_"));
  const proposals = relay.filter((tool) => tool.startsWith("propose_"));
  const workspace = [...read("apps/desktop/src/local-mcp.ts").matchAll(/name: "([a-z_]+)"/g)]
    .map((match) => match[1])
    .filter((name) => name !== "weaveforge-workspace");

  const list = (tools) => tools.map((tool) => `\`${tool}\``).join(", ");
  return [
    `**Read-only** (${n(reads.length)}): ${list(reads)}`,
    "",
    `**Proposal-only** (${n(proposals.length)}) — each saves an encrypted pending proposal, and`,
    `\`/ai-review\` is the only approval path: ${list(proposals)}`,
    "",
    `**The desktop workspace server** (${n(workspace.length)}): ${list(workspace)}`,
  ];
}

/** The gates `check:boundaries` actually runs today. */
function boundaryChecks() {
  const scripts = JSON.parse(read("package.json")).scripts;
  const names = (scripts["check:boundaries"] ?? "")
    .split("&&")
    .map((part) => part.trim().replace(/^npm run /, ""))
    .filter(Boolean);

  return [
    "| Gate | What it runs |",
    "| --- | --- |",
    ...names.map((name) => `| \`npm run ${name}\` | \`${scripts[name] ?? "—"}\` |`),
  ];
}

/**
 * Every generated block: which page it lives in, and what fills it.
 *
 * The id is in both markers so a page can hold several and a mismatched pair is
 * a visible mistake rather than a silently swallowed one.
 */
const BLOCKS = [
  { id: "code-map", doc: "docs/architecture-map.md", build: codeMap },
  { id: "desktop-ipc", doc: "docs/architecture-map.md", build: desktopIpc },
  { id: "mcp-tools", doc: "docs/MCP_IMPLEMENTATION.md", build: mcpTools },
  { id: "boundary-checks", doc: "docs/dev.md", build: boundaryChecks },
];

const NOTE = "<!-- Generated by scripts/update-docs.mjs — run `npm run docs:generate`. -->";

function fill(text, block, newline) {
  const start = `<!-- generated:${block.id} -->`;
  const end = `<!-- /generated:${block.id} -->`;
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from === -1 || to === -1) {
    throw new Error(`${block.doc} has no ${start} … ${end} block to fill.`);
  }
  const body = [start, "", NOTE, "", ...block.build(), "", end].join(newline);
  return text.slice(0, from) + body + text.slice(to + end.length);
}

const check = process.argv.includes("--check");
const stale = [];

for (const doc of new Set(BLOCKS.map((block) => block.doc))) {
  const full = path.join(ROOT, doc);
  const before = readFileSync(full, "utf8");
  const newline = before.includes("\r\n") ? "\r\n" : "\n";
  let after = before;
  for (const block of BLOCKS.filter((candidate) => candidate.doc === doc)) {
    after = fill(after, block, newline);
  }
  if (after === before) continue;
  if (check) stale.push(doc);
  else writeFileSync(full, after);
}

if (check) {
  if (stale.length === 0) {
    console.log("docs: generated blocks are up to date");
    process.exit(0);
  }
  console.error(`docs: out of date — ${stale.join(", ")}. Run \`npm run docs:generate\` and commit the result.`);
  process.exit(1);
}
console.log("docs: rewrote the generated blocks");
