/**
 * Settling a file both sides changed.
 *
 * The conflict policy lives in wf-core (`sync::folder_merge`); this module keeps the
 * app-side guards and the file write, and re-exports the wasm types the UI uses.
 */

import type { IWorkspaceFs, VaultPageBase } from "@weaveforge/core";
import type { ImportDiffEntry } from "@weaveforge/wasm";
import type { RustCore } from "@/lib/rust-core";

export type { ConflictPicks, ConflictResolution } from "@weaveforge/wasm";
import type { ConflictResolution } from "@weaveforge/wasm";

/**
 * Settle a both-changed file per field, or say what is actually in dispute.
 *
 * The folder's side is taken from the entry rather than re-read from the file,
 * because the entry's body has already had this account's asset links restored.
 * A folder with no recorded base stays a conflict for the person to decide.
 */
export function mergeBothChanged(
  core: RustCore,
  entry: ImportDiffEntry,
  base: VaultPageBase | undefined,
  workspaceContent: string | undefined,
): ImportDiffEntry {
  // A note over the WASM text limit cannot be merged here; it stays a conflict for the person to settle.
  if ((workspaceContent?.length ?? 0) > MAX_INDEX_TEXT_UTF16) return entry;
  let merged: ImportDiffEntry;
  try {
    merged = core.mergeBothChanged(entry, base, workspaceContent);
  } catch {
    return entry;
  }
  // The core hands back the entry unchanged when there is no base, no workspace copy, or no
  // vault page to read; keep the caller's own object in that case.
  if (merged.action === entry.action && merged.merge === undefined) return entry;
  return merged;
}

/** The index text limit, in UTF-16 units, that the WASM core enforces. */
const MAX_INDEX_TEXT_UTF16 = 16 * 1024 * 1024;

/**
 * Turn a settled conflict into an ordinary entry, or `null` to leave it alone.
 *
 * Markers, keep, and picks with nothing to compose from all settle to `null` in wf-core.
 */
export function settleConflict(
  core: RustCore,
  entry: ImportDiffEntry,
  resolutions: Readonly<Record<string, ConflictResolution>>,
): ImportDiffEntry | null {
  if (entry.action !== "conflict") return entry;
  return core.settleConflict(entry, resolutions) ?? null;
}

/**
 * Put this app's copy and the folder's copy into the file, marked, for a person
 * to settle in whatever they edit in.
 *
 * Only the body is marked. Frontmatter is not marked at all: it is key-value data,
 * and where two keys disagree the resolver settles them one at a time.
 *
 * Nothing reaches the workspace here. The file now differs from the recorded
 * base, so the mirror holds it back until the markers are gone.
 */
export async function writeConflictMarkersTo(
  core: RustCore,
  fs: IWorkspaceFs,
  entry: ImportDiffEntry,
): Promise<boolean> {
  const sides = entry.merge?.bodySides;
  if (!sides) return false;

  const current = await fs.readText(entry.entity.path).catch(() => null);
  if (current === null) return false;

  const { frontmatter } = core.readFrontmatter(current);
  await fs.writeFile(
    entry.entity.path,
    core.writeFrontmatter(frontmatter, core.writeConflictMarkers(sides.ours, sides.theirs)),
  );
  return true;
}
