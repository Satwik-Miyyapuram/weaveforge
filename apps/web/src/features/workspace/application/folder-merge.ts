/**
 * Settling a file both sides changed.
 *
 * Separated from `workspace-folder` because applying an import reaches for the
 * app container on its first line and this decision — which is the whole of the
 * conflict policy — can then be tested without one.
 */

import type {
  IWorkspaceFs,
  VaultPageBase,
} from "@weaveforge/core";
import type {
  ImportAction,
  ImportDiff,
  ImportDiffEntry,
} from "@weaveforge/wasm";
import type { HunkPick } from "@/lib/rust-core";
import { readyCore, type RustCore } from "@/lib/rust-core";

/**
 * Settle a both-changed file per field, or say what is actually in dispute.
 *
 * The folder's side is taken from the entry rather than re-read from the file,
 * because the entry's body has already had this account's asset links restored
 * -- comparing the raw file would report every note holding an image as
 * rewritten.
 *
 * Anything the merge cannot settle stays a conflict, and a folder with no
 * recorded base -- a manifest older than version 3, or a ZIP -- keeps the
 * behaviour it had: report, and let the user decide.
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
  return absentWhenNull(merged);
}

/** The index text limit, in UTF-16 units, that the WASM core enforces. */
const MAX_INDEX_TEXT_UTF16 = 16 * 1024 * 1024;

/** A key the folder deleted is `undefined` in a dispute, never `null`. */
function absentWhenNull(merged: ImportDiffEntry): ImportDiffEntry {
  if (!merged.merge) return merged;
  return {
    ...merged,
    merge: {
      ...merged.merge,
      disputed: merged.merge.disputed.map((d) => (d.theirs === null ? { ...d, theirs: undefined } : d)),
    },
  };
}

/**
 * What to do about a file both sides changed.
 *
 * `keep` leaves the workspace's copy alone, and the next mirror run writes it
 * back over the folder's. `folder` takes the folder's copy, losing the
 * workspace's. `both` imports the folder's copy as a new note and leaves the
 * workspace's untouched, which is the only one of the three that discards
 * nothing -- and the fallback `offline-first-sync.md` already settled on for
 * the database: keep both, tell the user.
 */
export type ConflictResolution = "keep" | "folder" | "both" | "markers" | ConflictPicks;

/**
 * A choice per disputed key, and per hunk of the body.
 *
 * Anything left out keeps ours, which is the direction an unsettled difference
 * always takes here: nothing is written on a guess.
 */
export interface ConflictPicks {
  kind: "picks";
  fields?: Readonly<Record<string, "ours" | "theirs">>;
  hunks?: Readonly<Record<number, HunkPick>>;
}

/** How the folder's copy is titled when both copies are kept. */
export function keepBothTitle(title: string): string {
  return `${title} (from folder)`;
}

/**
 * Turn a settled conflict into an ordinary entry, or `null` to leave it alone.
 *
 * Separated from applying because applying reaches for the app container on
 * its first line, and this decision -- which is the whole of the conflict
 * policy -- can then be tested without one.
 */
export function settleConflict(
  core: RustCore,
  entry: ImportDiffEntry,
  resolutions: Readonly<Record<string, ConflictResolution>>,
): ImportDiffEntry | null {
  if (entry.action !== "conflict") return entry;
  // A file still holding markers is not importable at all -- not its fields, not
  // its body. Where it is in dispute is a question for the person reading it,
  // and the answer arrives as an ordinary edit once the markers are gone.
  if (entry.kind === "markers") return null;

  const asked = resolutions[entry.entity.path] ?? "keep";
  // Writing markers is an action on the folder's copy, not an import: nothing
  // reaches the workspace until the person has edited the file.
  if (asked === "markers") return null;
  if (typeof asked === "object") return settlePicks(core, entry, asked);
  // A type mismatch has nothing to update: the id names a paper or an
  // experiment, so writing the file over it is not on offer whatever the
  // caller asked for. Importing it as a new note still is.
  const resolution = asked === "folder" && entry.kind === "type-mismatch" ? "both" : asked;
  if (resolution === "keep") return null;
  if (resolution === "folder") return { ...entry, action: "updated" };
  return {
    ...entry,
    action: "created",
    entity: { ...entry.entity, id: undefined, title: keepBothTitle(entry.entity.title) },
  };
}

/**
 * Compose a whole note out of the choices, and hand it over as an update.
 *
 * Null when there was nothing prepared to choose from: a type mismatch has no
 * merge, and a folder with no recorded base has no three sides to offer — in
 * both cases the shortcuts are the only honest answers.
 */
function settlePicks(
  core: RustCore,
  entry: ImportDiffEntry,
  picks: ConflictPicks,
): ImportDiffEntry | null {
  const detail = entry.merge;
  if (!detail) return null;

  const fields: Record<string, unknown> = { ...detail.fields };
  for (const dispute of detail.disputed) {
    const value = (picks.fields?.[dispute.field] ?? "ours") === "ours" ? dispute.ours : dispute.theirs;
    // Picking a side that deleted the key leaves the key out of the note.
    if (value === undefined) delete fields[dispute.field];
    else fields[dispute.field] = value;
  }

  const { title, ...rest } = fields;
  let body = detail.body;
  if (detail.bodySides) {
    try {
      body = core.mergeHunks(detail.bodySides.ours, detail.bodySides.theirs, picks.hunks ?? {});
    } catch {
      // A body over the WASM text limit cannot be composed; it stays a conflict.
      return null;
    }
  }

  return {
    ...entry,
    action: "updated",
    kind: undefined,
    reason: undefined,
    conflictFields: undefined,
    entity: {
      ...entry.entity,
      title: typeof title === "string" ? title : entry.entity.title,
      fields: rest as ImportDiffEntry["entity"]["fields"],
      body,
    },
  };
}

/**
 * Put this app's copy and the folder's copy into the file, marked, for a person
 * to settle in whatever they edit in.
 *
 * Only the body is marked. The two-way block is deliberate: a three-way one needs
 * the text the sides last agreed on, and the manifest keeps a digest of a body
 * rather than a copy of it — keeping one would double the folder to buy a merge
 * of the one field a person can settle by reading. Frontmatter is not marked at
 * all: it is key-value data, and where two keys disagree the resolver settles
 * them one at a time.
 *
 * Nothing reaches the workspace here. The file now differs from the recorded
 * base, so the mirror holds it back and keeps reporting it as an outside change
 * until the markers are gone — which is what makes a half-resolved file
 * impossible to import by accident.
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

export function countActions(entries: readonly ImportDiffEntry[]): ImportDiff["counts"] {
  return readyCore().countActions(entries);
}
