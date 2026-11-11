/**
 * Folder merge core, mirror manifest and folder-path helpers (Rust `sync::folder_merge`,
 * `sync::folder_mirror`, `sync::folder_layout`), re-exported from index.ts. Keeps the signatures
 * of apps/web workspace/application/{folder-merge,mirror-manifest,folder-import-apply,remove-project-folder}.ts.
 */
import {
  mergeBothChanged as rawMergeBothChanged,
  nextManifest as rawNextManifest,
} from "../pkg/wf_wasm.js";
import type { ImportDiffEntry, VaultPageBase } from "./bindings.js";

export {
  claimDigest,
  countActionList,
  countActions,
  folderTitleFromPath,
  jsonEditSince,
  keepBothTitle,
  movedPath,
  pickProjectFolder,
  readMirrorBase,
  readMirrorBases,
  rekeyManifestText,
  settleConflict,
  unstampForCompare,
} from "../pkg/wf_wasm.js";

/** A both-changed conflict merged field by field; any other entry, or a missing base or workspace copy, comes back as it was. */
export function mergeBothChanged(
  entry: ImportDiffEntry,
  base: VaultPageBase | undefined,
  workspaceContent: string | undefined,
): ImportDiffEntry {
  return rawMergeBothChanged(entry, base ?? null, workspaceContent) as ImportDiffEntry;
}

/** Previous manifest minus removed paths, plus written paths, deduped in first-seen order. */
export function nextManifest(
  previous: readonly string[],
  run: { written: readonly string[]; removed: readonly string[] },
): string[] {
  return rawNextManifest([...previous], [...run.written], [...run.removed]);
}

