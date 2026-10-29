#!/usr/bin/env node
/**
 * Offline pre-push check runner.
 *
 * Runs all validation gates locally before git push hits GitHub:
 * 1. desktop.ini purge
 * 2. Architecture map & docs freshness (check:docs)
 * 3. Commit DCO sign-offs (check:dco)
 * 4. Architectural & code boundaries (check:boundaries - 10 gates)
 * 5. WASM build, its tests and size budget, then typecheck across all workspaces (build:wasm, typecheck)
 * 6. Linter (lint)
 * 7. Bundle budget (bundle:budget, when .next build exists)
 * 8. Memory budgets (test:memory, ~5 s)
 * 9. Design page guards (test:e2e:design: targets and overflow, D20 G5/G6)
 * 10. Rust gates (check:rust --local: fmt, clippy, nextest, doctest, bindings, deny; scripts/lib/rust-gates.mjs)
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATED_DOCS } from "./lib/generated-docs.mjs";

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

// 2. Ensure docs are fresh. The pre-commit hook normally keeps them current;
// a commit made without it (commit-tree, a merge) is caught here and the
// regenerated docs are committed. A push cannot pick up a commit made during
// it, so the push stops and asks to be run again.
run("npm run docs:generate", "Regenerating architecture docs");
const docs = GENERATED_DOCS.join(" ");
if (execSync(`git status --porcelain -- ${docs}`, { cwd: root, encoding: "utf8" }).trim()) {
  run(`git commit -q -s -m "docs: regenerate generated blocks" -- ${docs}`, "Committing regenerated docs");
  console.error("\n[pre-push] Docs were out of date and are now committed. Run git push again.");
  process.exit(1);
}
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

// 5. Full workspace typecheck. @weaveforge/wasm imports the wasm-bindgen glue
// in packages/wf-wasm/pkg (gitignored), so build it first.
run("npm run build:wasm", "Building the Rust core to WASM");
run("npm test --workspace @weaveforge/wasm", "Testing the WASM package");
run("npm run wasm:budget", "Checking the WASM size budget");
run("npm run typecheck", "Typechecking all workspace packages");

// 6. Linter
run("npm run lint", "Running linter");

// 7. Bundle budget (if web build output exists)
if (existsSync(path.join(root, "apps/web/.next"))) {
  run("npm run bundle:budget", "Checking bundle budget");
}

// 8. Memory budgets: local database RSS and ink page open/close leaks
run("npm run test:memory", "Checking memory budgets");

// 9. Design page guards: targets and clipped text on planted pages, then on the
// real screens when the e2e account is configured (the screen spec skips itself
// otherwise).
run("npm run test:e2e:design --workspace @weaveforge/web", "Checking design page guards (D20 G5/G6)");

// 10. Rust gates for crates/, the same script CI runs.
run("npm run check:rust -- --local", "Running Rust gates (offline; advisories run in CI)");

console.log("\n==> [pre-push] All offline pre-push checks PASSED cleanly!\n");
