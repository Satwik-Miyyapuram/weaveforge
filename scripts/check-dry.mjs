#!/usr/bin/env node
/**
 * DRY checks for CI / pre-PR. Catches duplicated patterns we centralised in
 * helpers.
 *
 * The prose counterpart is docs/building/dev.md § Post-merge review checklist
 * (SOLID / DRY); when a rule changes, change both.
 *
 * As in check-solid.mjs, the search runs through scripts/lib/search.mjs and not
 * through `execSync("rg …")`. The old form read ripgrep's exit 1 as "no
 * matches" on every platform, but on Windows exit 1 is also what `cmd.exe`
 * reports for a binary that is not installed — so this gate passed without
 * having looked at anything.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { searchLines, searchedWith, trackedFiles } from "./lib/search.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const featureFiles = trackedFiles(root, [
  "apps/web/src/features",
  // The composition root and its facades. Not a feature, but the same rules
  // apply — and until this was added, every rule below was blind to the ~70
  // files that wire the features together, which is where several of them
  // (a facade's real dependency list) matter most.
  "apps/web/src/container",
]);

const search = (pattern, glob) =>
  searchLines({ root, files: featureFiles, pattern, glob });

let failed = false;

/**
 * Pinned owner labels belong in loadPinnedOwnerNames, not per-screen loops.
 *
 * The rule this replaces could not fire. It searched the feature ui folders for
 * `buildMemberNameMap`, then kept only lines in `-screen.tsx` or
 * `papers-list.tsx` — while exempting `shared-with-me-screen`, which by then was
 * the only UI file that called it at all. Every rule needs a subject; this one
 * had none, so it verified nothing and said so nowhere.
 *
 * What replaces it is an allowlist over the whole of `features/`, not a filter
 * over ui directories, because the question worth asking is where the map gets
 * rebuilt, not what kind of file rebuilds it — the old ui-only filter could not
 * even see `application/`, which is where the real callers live. Three files may
 * name it:
 *
 *   - `member-labels.ts` defines it;
 *   - `load-pinned-owner-names.ts` is the wrapper screens are meant to use;
 *   - `shared-with-me-screen.tsx` builds the map from `data.members`, which its
 *     use-case has already loaded. It costs no extra directory read, so it is not
 *     the duplication the wrapper exists to prevent — which is why the previous
 *     rule exempted it as well.
 *
 * Anywhere else is a screen or a component re-deriving a map that already
 * exists, whichever way it is spelled.
 *
 * Each entry is asserted against the file's contents rather than trusted, so the
 * list cannot rot into a hole that silently swallows the rule: if the definition
 * moves, or a sanctioned caller disappears, the gate fails until the entry is
 * corrected. An exemption nobody checks is how the previous version became
 * inert, and an unasserted allowlist is the same bug one step later.
 *
 * (Do not write a `glob` like the ui-directory pattern inside this comment. The
 * two asterisks and the slash in it spell the comment terminator, which ends the
 * comment early and turns the remainder of the line into code — a runtime
 * ReferenceError that `node --check` accepts, because what is left is still
 * valid syntax. That is exactly how this file shipped broken.)
 */
const MEMBER_LABEL_ALLOWED = new Map([
  [
    "apps/web/src/features/sharing/application/member-labels.ts",
    "export function buildMemberNameMap",
  ],
  [
    "apps/web/src/features/sharing/application/load-pinned-owner-names.ts",
    "buildMemberNameMap(dir)",
  ],
  [
    "apps/web/src/features/sharing/ui/shared-with-me-screen.tsx",
    "buildMemberNameMap(data.members)",
  ],
]);

const memberLabelLines = search("buildMemberNameMap");

for (const [file, marker] of MEMBER_LABEL_ALLOWED) {
  if (!memberLabelLines.some((line) => line.startsWith(`${file}:`) && line.includes(marker))) {
    console.error(
      `FAIL: check-dry exempts ${file} for buildMemberNameMap, and it no longer contains\n` +
        `      "${marker}". Update the entry in scripts/check-dry.mjs to match where the code went.`,
    );
    failed = true;
  }
}

const pinnedLabelDupes = memberLabelLines.filter(
  (line) => ![...MEMBER_LABEL_ALLOWED.keys()].some((file) => line.startsWith(`${file}:`)),
);
if (pinnedLabelDupes.length) {
  console.error(
    "FAIL: buildMemberNameMap is used outside the module and helper that own it — call loadPinnedOwnerNames():",
  );
  for (const line of pinnedLabelDupes) console.error(`  ${line}`);
  failed = true;
}

/** Share-matching rules live in @weaveforge/core — not in UI. */
const shareMatchInUi = search("shareCoversResource|shareAllowsComment", "**/ui/**");
if (shareMatchInUi.length) {
  console.error("FAIL: share matching belongs in use-cases / @weaveforge/core, not UI:");
  for (const line of shareMatchInUi) console.error(`  ${line}`);
  failed = true;
}

/** Pin merge logic belongs in Load*ScreenUseCase + mergePinnedScreenData. */
const pinMergeInUi = search("mergePinnedScreenData|listForProject\\(\\)", "**/ui/**");
if (pinMergeInUi.length) {
  console.error("FAIL: pin merge / library_pins access belongs in screen use-cases, not UI:");
  for (const line of pinMergeInUi) console.error(`  ${line}`);
  failed = true;
}

/**
 * Per-kind decisions live in the editor workspace's kind table.
 *
 * `docs/internal/design/editor-workspace-redesign.md` §3.3: "No `if (kind ===
 * "paper")` outside those tables. If a step needs a per-kind branch, it adds a
 * column to `kind.ts`." The rule exists because the branch is the thing that
 * grows: each one is a place ink notes, a new entity kind or a new pane mode
 * has to be remembered.
 *
 * What this catches is a comparison against a *kind literal*. It deliberately
 * does not catch `node.kind === kind` — comparing one value to another, as the
 * breadcrumb walk and the palette's grouping both do — because that is asking
 * "are these the same kind", not deciding behaviour for a particular one. Tests
 * are exempt for the same reason the rule exists: asserting that a paper came
 * back as a paper is the assertion, not a decision the product makes.
 */
const KIND_LITERAL = 'kind === "(vault_page|paper|report_section|reading_list|experiment|milestone|log_entry|folder)"';
const kindBranches = search(KIND_LITERAL, "apps/web/src/features/editor-workspace/**/*.{ts,tsx}");
const kindBranchOwners = [
  "ui/kind.ts",
  "ui/document-host.tsx",
  "application/workspace-tree.ts",
  "/test/",
];
const strayKindBranches = kindBranches.filter(
  (line) => !kindBranchOwners.some((owner) => line.replace(/\\/g, "/").includes(owner)),
);
if (strayKindBranches.length) {
  console.error(
    "FAIL: per-kind branch outside the kind table — add a column to ui/kind.ts instead:",
  );
  for (const line of strayKindBranches) console.error(`  ${line}`);
  failed = true;
}

/**
 * Types declared inline as `import("@weaveforge/core").X`.
 *
 * A class's real dependency list has to be readable at the top of the file.
 * Declaring types inline — sometimes twice for the same name, in a file that
 * already imports nine other types normally — turns reviewing a constructor into
 * parsing dynamic-import expressions, and spells one concept two ways in one
 * file. Hoisting them costs nothing at runtime: a type-only import erases.
 *
 * Only the core specifier is banned. A type query against a sibling module
 * (`import("@/features/…/thing").Thing`) is left alone on purpose: those are
 * mostly lazy-loaded modules, where the inline form is the local convention.
 */
const inlineCoreTypes = search('import\\("@weaveforge/core"\\)\\.', "**/*.{ts,tsx}");
if (inlineCoreTypes.length) {
  console.error(
    'FAIL: types declared inline as import("@weaveforge/core").X — hoist them into a top-level import type:',
  );
  for (const line of inlineCoreTypes) console.error(`  ${line}`);
  failed = true;
}

if (failed) {
  console.error("\nSee docs/building/dev.md § Post-merge review checklist (SOLID / DRY).");
  process.exit(1);
}

console.log(`DRY checks passed (${featureFiles.length} files, ${searchedWith()}).`);
