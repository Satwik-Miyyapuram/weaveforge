#!/usr/bin/env node
/**
 * Offline check: internal markdown links and anchors in the docs resolve to
 * tracked files. Reads the working tree, so an unstaged edit is checked too.
 *
 *   node scripts/check-doc-links.mjs
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { brokenLinks, extractLinks } from "./lib/doc-links.mjs";
import { ROOT, TRACKED } from "./lib/repo-stats.mjs";

// Plans and internal notes are dated records; their links were true when written.
const docFiles = TRACKED.filter(
  (rel) =>
    rel.endsWith(".md") &&
    ((rel.startsWith("docs/") && !/^docs\/(plans|internal)\//.test(rel)) ||
      rel === "README.md" ||
      /^\.agents\/[^/]+\.md$/.test(rel)),
);

const tracked = new Set(TRACKED);
const text = new Map();
const readTracked = (rel) => {
  if (!text.has(rel)) text.set(rel, readFileSync(path.join(ROOT, rel), "utf8"));
  return text.get(rel);
};

const misses = [];
for (const rel of docFiles) {
  const links = extractLinks(readTracked(rel));
  for (const { line, target, why } of brokenLinks(rel, links, tracked, readTracked)) {
    misses.push(`${rel}:${line}  broken link  ${target}  (${why})`);
  }
}

for (const miss of misses) console.log(miss);
console.log(`doc-links: ${misses.length} broken`);
if (misses.length) process.exitCode = 1;
