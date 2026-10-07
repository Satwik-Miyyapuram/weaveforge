#!/usr/bin/env node
/**
 * Offline pre-push check runner.
 *
 * Runs all validation gates locally before git push hits GitHub:
 * 1. desktop.ini purge
 * 2. Architecture map & docs freshness (check:docs)
 * 3. Commit DCO sign-offs (check:dco)
 * 4. Architectural & code boundaries (check:boundaries - 10 gates)
 * 5. Typecheck across all workspaces (typecheck)
 * 6. Linter (lint)
 * 7. Bundle budget (bundle:budget, when .next build exists)
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, desc) {
  console.log(`\n==> [pre-push] ${desc}...`);
  try {
    execSync(cmd, { cwd: root, stdio: "inherit" });
  } catch {
    console.error(`\n[pre-push] FAILED: ${desc} (${cmd})`);
    process.exit(1);
  }
}

// 1. Purge any rogue desktop.ini files
run("node scripts/clean-desktop-ini.mjs", "Cleaning rogue desktop.ini files");

// 2. Ensure docs are fresh
run("npm run docs:generate", "Regenerating architecture docs");
run("npm run check:docs", "Verifying architecture docs freshness");

// 3. DCO check against origin/main (or upstream)
let baseSha = "origin/main";
try {
  execSync("git rev-parse --verify origin/main", { stdio: "ignore" });
} catch {
  baseSha = "HEAD~1";
}
run(`node scripts/check-dco.mjs ${baseSha} HEAD`, `Checking DCO sign-offs (${baseSha}..HEAD)`);

// 4. Boundary gates (SOLID, DRY, API routes, UI, contrast, hygiene, MCP, Android, CI parity)
run("npm run check:boundaries", "Running architectural boundary gates");

// 5. Full workspace typecheck
run("npm run typecheck", "Typechecking all workspace packages");

// 6. Linter
run("npm run lint", "Running linter");

// 7. Bundle budget (if web build output exists)
if (existsSync(path.join(root, "apps/web/.next"))) {
  run("npm run bundle:budget", "Checking bundle budget");
}

console.log("\n==> [pre-push] All offline pre-push checks PASSED cleanly!\n");
