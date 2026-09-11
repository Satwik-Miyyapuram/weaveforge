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

const featureFiles = trackedFiles(root, ["apps/web/src/features"]);

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

if (failed) {
  console.error("\nSee docs/building/dev.md § Post-merge review checklist (SOLID / DRY).");
  process.exit(1);
}

console.log(`DRY checks passed (${featureFiles.length} files, ${searchedWith()}).`);
