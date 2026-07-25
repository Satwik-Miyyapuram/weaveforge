#!/usr/bin/env node
/**
 * SOLID boundary checks for CI / pre-PR. Exits 1 when violations are found.
 */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function rg(pattern, extraArgs = "") {
  try {
    const out = execSync(`rg -l "${pattern}" apps/web/src/features ${extraArgs}`, {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return out.trim().split(/\r?\n/).filter(Boolean);
  } catch (e) {
    if (e.status === 1) return [];
    throw e;
  }
}

let failed = false;

const supabaseInUi = rg("@supabase", '--glob "**/ui/**"');
if (supabaseInUi.length) {
  console.error("FAIL: Supabase imports under features/**/ui/:");
  for (const f of supabaseInUi) console.error(`  ${f}`);
  failed = true;
}

const crossUiLines = (() => {
  try {
    return execSync(
      `rg "from [\\"']@/features/([a-z-]+)/ui/" apps/web/src/features --glob "*.{ts,tsx}"`,
      { cwd: root, encoding: "utf8" },
    )
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
})();

for (const line of crossUiLines) {
  const m = line.match(/^([^:]+):.*@\/features\/([a-z-]+)\/ui\//);
  if (!m) continue;
  const [, file, feature] = m;
  const importer = file.replace(/\\/g, "/").match(/features\/([a-z-]+)\//)?.[1];
  if (importer && importer !== feature) {
    console.error(`FAIL: cross-feature ui import: ${line}`);
    failed = true;
  }
}

const repoInUi = (() => {
  try {
    return execSync(
      `rg "getContainer\\(\\)\\.\\w+Repository" apps/web/src/features --glob "**/ui/**"`,
      { cwd: root, encoding: "utf8" },
    )
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
})();
if (repoInUi.length) {
  console.error("FAIL: UI reaches repositories via getContainer (use facades):");
  for (const line of repoInUi) console.error(`  ${line}`);
  failed = true;
}

if (failed) {
  console.error("\nSee docs/CONTRIBUTING.md § SOLID PR checklist.");
  process.exit(1);
}

console.log("SOLID boundary checks passed.");
