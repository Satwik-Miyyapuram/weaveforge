/**
 * Settling a file both sides changed.
 *
 * Separated from `workspace-folder` because applying an import reaches for the
 * app container on its first line and this decision — which is the whole of the
 * conflict policy — can then be tested without one.
 */

import type {
  ImportAction,
  ImportDiff,
  ImportDiffEntry,
  IWorkspaceFs,
  ImportMergeDetail,
  MergeFieldDispute,
  VaultPageBase,
} from "@weaveforge/core";
import {
  mergeHunks,
  mergeVaultPage,
  readFrontmatter,
  vaultPageSide,
  writeConflictMarkers,
  writeFrontmatter,
  type HunkPick,
} from "@weaveforge/core";

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
  entry: ImportDiffEntry,
  base: VaultPageBase | undefined,
  workspaceContent: string | undefined,
): ImportDiffEntry {
  if (entry.action !== "conflict" || entry.kind !== "both-changed") return entry;
  if (!base || workspaceContent === undefined) return entry;

  const workspace = vaultPageSide(entry.entity.path, workspaceContent);
  if (!workspace) return entry;

  const merged = mergeVaultPage(
    base,
    { fields: { ...entry.entity.fields, title: entry.entity.title }, body: entry.entity.body },
    workspace,
  );

  if (merged.conflicts.length > 0) {
    const fields = merged.conflicts.map((conflict) => conflict.field);
    return {
      ...entry,
      conflictFields: fields,
      merge: mergeDetail(merged, entry, workspace),
      reason: `${entry.entity.path}: both sides changed ${listFields(fields)}.`,
    };
  }

  const { title, ...fields } = merged.fields;
  return {
    ...entry,
    action: "updated",
    kind: undefined,
    reason: undefined,
    entity: {
      ...entry.entity,
      title: typeof title === "string" ? title : entry.entity.title,
      fields: fields as ImportDiffEntry["entity"]["fields"],
      body: merged.body,
    },
  };
}

/**
 * What the resolver may choose between, as opposed to what the merge settled.
 *
 * `merged.fields` and `merged.body` already carry every change only one side
 * made, and stand as ours where the two disagree, so a settlement is composed
 * from them rather than from the file: take these, override the disputed keys
 * and body hunks, write that. `bodySides` travels only when the body itself is
 * in dispute, because the hunk diff needs both copies and `merged.conflicts`
 * carries digests for a body, never text.
 */
function mergeDetail(
  merged: ReturnType<typeof mergeVaultPage>,
  entry: ImportDiffEntry,
  workspace: ReturnType<typeof vaultPageSide> & object,
): ImportMergeDetail {
  const disputed: MergeFieldDispute[] = merged.conflicts
    .filter((conflict) => conflict.field !== "body")
    // local is the folder's side and remote the workspace's, so they land on
    // `theirs` and `ours` respectively.
    .map((conflict) => ({
      field: conflict.field,
      base: conflict.base,
      ours: conflict.remote,
      theirs: conflict.local,
    }));
  const bodyDisputed = merged.conflicts.some((conflict) => conflict.field === "body");

  return {
    fields: merged.fields,
    body: merged.body,
    disputed,
    ...(bodyDisputed
      ? { bodySides: { ours: workspace.body, theirs: entry.entity.body } }
      : {}),
  };
}

function listFields(fields: readonly string[]): string {
  if (fields.length === 1) return fields[0]!;
  return `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}`;
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
  if (typeof asked === "object") return settlePicks(entry, asked);
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
function settlePicks(entry: ImportDiffEntry, picks: ConflictPicks): ImportDiffEntry | null {
  const detail = entry.merge;
  if (!detail) return null;

  const fields: Record<string, unknown> = { ...detail.fields };
  for (const dispute of detail.disputed) {
    fields[dispute.field] = (picks.fields?.[dispute.field] ?? "ours") === "ours"
      ? dispute.ours
      : dispute.theirs;
  }

  const { title, ...rest } = fields;
  const body = detail.bodySides
    ? mergeHunks(detail.bodySides.ours, detail.bodySides.theirs, picks.hunks ?? {})
    : detail.body;

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
  fs: IWorkspaceFs,
  entry: ImportDiffEntry,
): Promise<boolean> {
  const sides = entry.merge?.bodySides;
  if (!sides) return false;

  const current = await fs.readText(entry.entity.path).catch(() => null);
  if (current === null) return false;

  const { frontmatter } = readFrontmatter(current);
  await fs.writeFile(
    entry.entity.path,
    writeFrontmatter(frontmatter, writeConflictMarkers(sides.ours, sides.theirs)),
  );
  return true;
}

export function countActions(entries: readonly ImportDiffEntry[]): ImportDiff["counts"] {
  const counts: ImportDiff["counts"] = {
    created: 0,
    updated: 0,
    unchanged: 0,
    conflict: 0,
    removed: 0,
  };
  for (const entry of entries) counts[entry.action] += 1;
  return counts;
}
