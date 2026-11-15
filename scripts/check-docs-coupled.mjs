#!/usr/bin/env node
/**
 * Blocks a PR that changes code a `docs/using` page covers without changing the
 * page. Waive with a `docs-ok: <reason>` line in the PR body (env PR_BODY).
 * See scripts/lib/doc-freshness.mjs.
 *
 *   node scripts/check-docs-coupled.mjs <base> <head>
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { frontMatter, uncoupledPages } from "./lib/doc-freshness.mjs";
import { ROOT } from "./lib/repo-stats.mjs";

const [base, head] = process.argv.slice(2);
if (!base || !head) {
  console.error("usage: node scripts/check-docs-coupled.mjs <base> <head>");
  process.exit(2);
}

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const changed = git("diff", "--name-only", `${base}...${head}`).split("\n").filter(Boolean);

const docsDir = path.join(ROOT, "docs/using");
const pages = [];
for (const name of fs.readdirSync(docsDir).filter((entry) => entry.endsWith(".md")).sort()) {
  const meta = frontMatter(fs.readFileSync(path.join(docsDir, name), "utf8"));
  if (meta) pages.push({ file: `docs/using/${name}`, covers: meta.covers });
}

const annotate = Boolean(process.env.GITHUB_ACTIONS);
const misses = uncoupledPages(changed, pages, process.env.PR_BODY);
for (const { file, because } of misses) {
  const message = `${because} changed; update this page or add "docs-ok: <reason>" to the PR body`;
  console.log(annotate ? `::error file=${file},line=1::${message}` : `${file}: ${message}`);
}
console.log(misses.length === 0 ? "docs-coupled: ok" : `docs-coupled: ${misses.length} page(s) need an update`);
if (misses.length > 0) process.exitCode = 1;
