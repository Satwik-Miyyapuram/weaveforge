#!/usr/bin/env node
/**
 * Sync layer 5: docs name code that exists. Fails when a doc's path or
 * identifier is not in the tracked tree, or a code root has no AREAS row.
 *
 *   node scripts/check-doc-refs.mjs
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { AREAS } from "./lib/areas.mjs";
import { codeRoots, extractRefs, missingAreaRows, missingFiles, missingIdents, missingPaths } from "./lib/doc-refs.mjs";
import { ROOT, TRACKED, readIndex } from "./lib/repo-stats.mjs";

const WORD_EXT = new Set([".rs", ".ts", ".tsx", ".mjs", ".js", ".sql", ".py", ".kt", ".kts", ".toml", ".json"]);
const SKIP = /(^|\/)(node_modules|target)\/|(^|\/)package-lock\.json$/;

const allow = readFileSync(path.join(ROOT, "scripts/doc-refs-allow.txt"), "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

const tracked = new Set(TRACKED);

const wordFiles = TRACKED.filter((rel) => WORD_EXT.has(path.extname(rel)) && !SKIP.test(rel));
const wordSet = new Set();
for (const text of readIndex(ROOT, wordFiles).values()) {
  for (const word of text.match(/\w+/g) ?? []) wordSet.add(word);
}

// Plans and internal notes are dated records; the paths they name were true when written.
const docFiles = TRACKED.filter(
  (rel) => rel.startsWith("docs/") && rel.endsWith(".md") && !/^docs\/(plans|internal)\//.test(rel),
);
// Working-tree text, so an unstaged doc edit is checked before it is committed.
const docs = new Map(docFiles.map((rel) => [rel, readFileSync(path.join(ROOT, rel), "utf8")]));

const misses = [];
for (const rel of docFiles) {
  const { paths, idents, files } = extractRefs(docs.get(rel) ?? "");
  for (const { text, line } of missingPaths(paths, tracked, allow)) {
    misses.push({ at: `${rel}:${line}`, kind: "path", text });
  }
  for (const { text, line } of missingFiles(files, tracked, allow)) {
    misses.push({ at: `${rel}:${line}`, kind: "file", text });
  }
  for (const { text, line } of missingIdents(idents, wordSet, allow)) {
    misses.push({ at: `${rel}:${line}`, kind: "ident", text });
  }
}

const areaDirs = AREAS.map((row) => row.dir);
for (const root of missingAreaRows(codeRoots(TRACKED), areaDirs)) {
  misses.push({ at: "scripts/lib/areas.mjs", kind: "area row", text: root });
}

for (const miss of misses) console.log(`${miss.at}  missing ${miss.kind}  ${miss.text}`);
console.log(`doc-refs: ${misses.length} miss${misses.length === 1 ? "" : "es"}`);
if (misses.length) process.exitCode = 1;
