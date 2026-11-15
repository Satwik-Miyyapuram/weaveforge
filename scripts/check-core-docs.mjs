#!/usr/bin/env node
/**
 * Core docs drift: every crates/wf-core/src module needs a page under
 * docs/building/core, and every page must be linked from its README.
 *
 *   node scripts/check-core-docs.mjs
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { coreModules, undocumentedModules, unlistedPages } from "./lib/core-docs.mjs";
import { ROOT, TRACKED } from "./lib/repo-stats.mjs";

// Modules with no page on purpose; add a name only with a reason.
const ALLOW = [];

const CORE_DOCS = "docs/building/core/";
const README = `${CORE_DOCS}README.md`;

// Working-tree text, so an unstaged doc edit is checked before it is committed.
const pageFiles = TRACKED.filter((rel) => rel.startsWith(CORE_DOCS) && rel.endsWith(".md") && !rel.slice(CORE_DOCS.length).includes("/"));
const readme = readFileSync(path.join(ROOT, README), "utf8");
const pageNames = pageFiles.filter((rel) => rel !== README).map((rel) => rel.slice(CORE_DOCS.length));
const pagesText = pageFiles
  .filter((rel) => rel !== README)
  .map((rel) => readFileSync(path.join(ROOT, rel), "utf8"))
  .join("\n");

const misses = [
  ...unlistedPages(pageNames, readme).map((name) => ({ at: README, problem: `page not linked: ${name}` })),
  ...undocumentedModules(coreModules(TRACKED), pagesText, ALLOW).map((name) => ({
    at: `crates/wf-core/src/${name}`,
    problem: "no core page mentions it",
  })),
];

for (const miss of misses) console.log(`${miss.at}  ${miss.problem}`);
console.log(`core-docs: ${misses.length} miss${misses.length === 1 ? "" : "es"}`);
if (misses.length) process.exitCode = 1;
