#!/usr/bin/env node
/**
 * Blocks a change to code a `docs/using` page covers without a change to the
 * page. Waive with a `docs-ok: <reason>` line in a commit message of the
 * checked commits, or in the PR body (env PR_BODY, CI only).
 * See scripts/lib/doc-freshness.mjs.
 *
 *   node scripts/check-docs-coupled.mjs --unpushed     commits on no remote (pre-push)
 *   node scripts/check-docs-coupled.mjs <base> <head>  the change base...head (CI)
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { frontMatter, uncoupledPages } from "./lib/doc-freshness.mjs";

const args = process.argv.slice(2);
const unpushed = args[0] === "--unpushed";
const [base, head] = args;
if (!unpushed && (!base || !head)) {
  console.error("usage: node scripts/check-docs-coupled.mjs --unpushed | <base> <head>");
  process.exit(2);
}

const git = (...gitArgs) => execFileSync("git", gitArgs, { encoding: "utf8" }).trim();
const ROOT = git("rev-parse", "--show-toplevel");
const lines = (text) => text.split("\n").filter(Boolean);

// Pre-push sees each unpushed commit's own files (a merge lists none); CI sees
// the net change of the PR.
const changed = unpushed
  ? [...new Set(lines(git("log", "--name-only", "--format=", "HEAD", "--not", "--remotes")))]
  : lines(git("diff", "--name-only", `${base}...${head}`));
const messages = unpushed
  ? git("log", "--format=%B", "HEAD", "--not", "--remotes")
  : git("log", "--format=%B", `${base}..${head}`);

const docsDir = path.join(ROOT, "docs/using");
const pages = [];
for (const name of fs.readdirSync(docsDir).filter((entry) => entry.endsWith(".md")).sort()) {
  const meta = frontMatter(fs.readFileSync(path.join(docsDir, name), "utf8"));
  if (meta) pages.push({ file: `docs/using/${name}`, covers: meta.covers });
}

const annotate = Boolean(process.env.GITHUB_ACTIONS);
const misses = uncoupledPages(changed, pages, `${process.env.PR_BODY ?? ""}\n${messages}`);
for (const { file, because } of misses) {
  const message = `${because} changed; update this page or add a "docs-ok: <reason>" line to a commit message`;
  console.log(annotate ? `::error file=${file},line=1::${message}` : `${file}: ${message}`);
}
console.log(misses.length === 0 ? "docs-coupled: ok" : `docs-coupled: ${misses.length} page(s) need an update`);
if (misses.length > 0) process.exitCode = 1;
