#!/usr/bin/env node
/**
 * SOLID boundary checks for CI / pre-PR. Exits 1 when violations are found.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

// The workspace snapshot is the full read of a project behind the export, the
// folder mirror, and the search index. It must come from repositories: the
// screen facades return card projections that drop note bodies and paper
// abstract/bibtex/metadata, and both attachment scans key off those fields.
// Reading through them once shipped exports with empty notes and no assets.
const snapshotConsumers = [
  "apps/web/src/features/export/application/export-user-data.ts",
];
for (const file of snapshotConsumers) {
  const source = readFileSync(path.join(root, file), "utf8");
  for (const banned of ["loadScreenData(", "listSummaries("]) {
    if (source.includes(banned)) {
      console.error(
        `FAIL: ${file} calls ${banned} — build from container.workspace.snapshot() instead.\n` +
          "      Card projections drop note bodies and paper metadata, which silently\n" +
          "      empties the export and drops every attachment.",
      );
      failed = true;
    }
  }
}

// No provider is ranked. A default ordering, a fallback chain, or a hardcoded
// list of "the providers" is how a supposedly neutral system acquires a
// favourite: whichever name sits first becomes the one everyone runs, and the
// endpoint the user actually chose becomes the exception. Which model runs is
// an explicit choice made in settings, so the domain layer carries no roster.
const providerRosterFiles = [
  "packages/core/src/features/ai-assistant/domain/ai-types.ts",
  "packages/core/src/features/ai-assistant/domain/ai-model-router.ts",
  "packages/core/src/features/ai-assistant/domain/model-concept-extractor.ts",
];
for (const file of providerRosterFiles) {
  const source = readFileSync(path.join(root, file), "utf8");
  for (const banned of ["AI_MODEL_PROVIDER_ORDER", "SUGGESTED_AI_PROVIDER_IDS", "PROVIDER_PRESETS"]) {
    if (source.includes(banned)) {
      console.error(
        `FAIL: ${file} declares ${banned} — the domain layer must not rank or enumerate providers.\n` +
          "      Presets belong to the settings UI, where they are visibly starting\n" +
          "      points rather than a whitelist the rest of the app reads.",
      );
      failed = true;
    }
  }
}

const facadeWiredSnapshot = (() => {
  const source = readFileSync(path.join(root, "apps/web/src/create-app-container.ts"), "utf8");
  const wiring = /new WorkspaceFacade\(\{([\s\S]*?)\}\)/.exec(source)?.[1] ?? "";
  return [...wiring.matchAll(/^\s*\w+:\s*([\w.]*Facade)\b/gm)].map((m) => m[1]);
})();
if (facadeWiredSnapshot.length) {
  console.error(
    `FAIL: WorkspaceFacade is wired with facades (${facadeWiredSnapshot.join(", ")}) — pass repositories.`,
  );
  failed = true;
}

if (failed) {
  console.error("\nSee docs/CONTRIBUTING.md § SOLID PR checklist.");
  process.exit(1);
}

console.log("SOLID boundary checks passed.");
