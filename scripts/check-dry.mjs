#!/usr/bin/env node
/**
 * DRY checks for CI / pre-PR. Catches duplicated patterns we centralised in helpers.
 */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function rgLines(pattern, extraArgs = "") {
  try {
    return execSync(`rg -n "${pattern}" apps/web/src/features ${extraArgs}`, {
      cwd: root,
      encoding: "utf8",
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
  } catch (e) {
    if (e.status === 1) return [];
    throw e;
  }
}

let failed = false;

/** Pinned owner labels belong in loadPinnedOwnerNames, not per-screen loops. */
const pinnedLabelDupes = rgLines("buildMemberNameMap", '--glob "**/ui/**"').filter(
  (line) =>
    !line.includes("member-labels") &&
    !line.includes("shared-with-me-screen") &&
    (line.includes("-screen.tsx") || line.includes("papers-list.tsx")),
);
if (pinnedLabelDupes.length) {
  console.error("FAIL: use loadPinnedOwnerNames() instead of buildMemberNameMap in screens:");
  for (const line of pinnedLabelDupes) console.error(`  ${line}`);
  failed = true;
}

/** Share-matching rules live in @weaveforge/core — not in UI. */
const shareMatchInUi = rgLines("shareCoversResource|shareAllowsComment", '--glob "**/ui/**"');
if (shareMatchInUi.length) {
  console.error("FAIL: share matching belongs in use-cases / @weaveforge/core, not UI:");
  for (const line of shareMatchInUi) console.error(`  ${line}`);
  failed = true;
}

/** Pin merge logic belongs in Load*ScreenUseCase + mergePinnedScreenData. */
const pinMergeInUi = rgLines("mergePinnedScreenData|listForProject\\(\\)", '--glob "**/ui/**"');
if (pinMergeInUi.length) {
  console.error("FAIL: pin merge / library_pins access belongs in screen use-cases, not UI:");
  for (const line of pinMergeInUi) console.error(`  ${line}`);
  failed = true;
}

if (failed) {
  console.error("\nSee docs/dev.md § Post-merge review checklist (SOLID / DRY).");
  process.exit(1);
}

console.log("DRY checks passed.");
