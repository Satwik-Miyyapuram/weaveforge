#!/usr/bin/env node
/**
 * Warns when code a `docs/using` page covers changed after the page was last
 * checked. Always exits 0; see scripts/lib/doc-freshness.mjs.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { frontMatter, pageWarnings } from "./lib/doc-freshness.mjs";
import { ROOT } from "./lib/repo-stats.mjs";

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

// A shallow clone dates every file to the one commit it has, so dates say nothing.
const shallow = git("rev-parse", "--is-shallow-repository") === "true";
if (shallow) console.log("docs-freshness: shallow clone, skipping the date check");

const io = {
  exists: (dir) => fs.existsSync(path.join(ROOT, dir)),
  // Test-only changes do not move what a user sees.
  lastChange: (dir) =>
    shallow
      ? null
      : git("log", "-1", "--format=%cs", "--", dir, ":(glob,exclude)**/test/**", ":(glob,exclude)**/*.test.*") || null,
};

const annotate = Boolean(process.env.GITHUB_ACTIONS);
const docsDir = path.join(ROOT, "docs/using");
let count = 0;
for (const page of fs.readdirSync(docsDir).filter((name) => name.endsWith(".md")).sort()) {
  const file = `docs/using/${page}`;
  for (const warning of pageWarnings(frontMatter(fs.readFileSync(path.join(docsDir, page), "utf8")), io)) {
    console.log(annotate ? `::warning file=${file},line=1::${warning}` : `${file}: ${warning}`);
    count += 1;
  }
}
console.log(count === 0 ? "docs-freshness: every page was checked after its code last changed" : `docs-freshness: ${count} warning(s)`);
