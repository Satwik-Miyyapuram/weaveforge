#!/usr/bin/env node
/**
 * SOLID boundary checks for CI / pre-PR. Exits 1 when violations are found.
 *
 * The prose counterpart of every rule below is CONTRIBUTING.md § SOLID PR
 * checklist and docs/building/dev.md § SOLID boundaries — when a rule changes,
 * change all three.
 *
 * The searching is done by scripts/lib/search.mjs rather than by shelling out
 * to ripgrep here, and that is a correctness fix rather than tidying: `rg` was
 * invoked through `execSync`, which on Windows runs the command through
 * `cmd.exe`, where a missing binary exits 1 — the same code ripgrep uses for
 * "nothing matched". The gate therefore reported a pass on a machine without
 * ripgrep while having checked nothing. The search module runs the same rules
 * over the same files in Node when ripgrep is unusable, and fails loudly
 * instead of quietly when even that is impossible.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { searchLines, searchedWith, trackedFiles } from "./lib/search.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The files the search runs over: everything git tracks under `features/`.
 *
 * Taken from git (`ls-files`) rather than by walking the directory, so a build
 * output directory or a scratch file cannot be searched — or, worse, reported
 * as a violation — and so a contributor and CI look at the same set. The list
 * is handed to the search as-is; see scripts/lib/search.mjs for why the paths
 * travel as data rather than on a command line.
 */
const featureFiles = trackedFiles(root, ["apps/web/src/features"]);

const search = (pattern, glob) =>
  searchLines({ root, files: featureFiles, pattern, glob });

let failed = false;

const supabaseInUi = search("@supabase", "**/ui/**");
if (supabaseInUi.length) {
  console.error("FAIL: Supabase imports under features/**/ui/:");
  for (const f of supabaseInUi) console.error(`  ${f}`);
  failed = true;
}

// Cross-feature `ui/` imports.
//
// The rule is about a feature reaching into another feature's presentation:
// `features/reader/ui/…` is reader's business, and a second feature importing
// it couples two screens through one component's file layout. What it is not
// about is the composition layer above features — `app/`, `components/` — or
// the shell, which exist to assemble features and therefore import their `ui/`
// entry points by design. `app/app-shell.tsx` importing
// `@/features/auth/ui/auth-provider` is the app being the app, so the search
// deliberately covers `features/**` only. Widening it to `apps/web/src` would
// fail on about twenty legitimate imports and teach everyone to ignore the
// rule; what the rule actually verifies is stated here so its coverage is not
// mistaken for something broader.
//
// A file whose own feature cannot be derived from its path is skipped: an
// import from a shared helper under `features/<name>/…` is the only case, and
// guessing an owner for it would invent a violation.
const CROSS_UI_IMPORT = /^([^:]+):\d+:.*@\/features\/([a-z-]+)\/ui\//;
for (const line of search('from ["\']@/features/([a-z-]+)/ui/', "*.{ts,tsx}")) {
  const match = line.match(CROSS_UI_IMPORT);
  if (!match) continue;
  const [, file, feature] = match;
  const importer = file.replace(/\\/g, "/").match(/features\/([a-z-]+)\//)?.[1];
  if (importer && importer !== feature) {
    console.error(`FAIL: cross-feature ui import: ${line}`);
    failed = true;
  }
}

const repoInUi = search("getContainer\\(\\)\\.\\w+Repository", "**/ui/**");
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
  console.error("\nSee CONTRIBUTING.md § SOLID PR checklist.");
  process.exit(1);
}

console.log(`SOLID boundary checks passed (${featureFiles.length} files, ${searchedWith()}).`);
