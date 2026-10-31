/**
 * Outside edits (made in the connected folder by another program) are taken in
 * without asking only when the folder changed and the app did not. Anything
 * made on both sides, removed, or without a record of the app's last write
 * stays for a person to review.
 */
import type { ImportAction, ImportDiff, JsonDiff } from "@weaveforge/core";

export type FolderDiff = ImportDiff & { json?: JsonDiff };

type AnyEntry = { action: ImportAction; entity?: { path: string }; path?: string };

/** The part of a folder diff safe to take in without asking, and the part a person must see. */
export function splitOutsideEdits(
  diff: FolderDiff,
  base: Readonly<Record<string, string>>,
): { apply: FolderDiff; held: FolderDiff } {
  const split = (entries: AnyEntry[]) => {
    const apply: AnyEntry[] = [];
    const held: AnyEntry[] = [];
    for (const entry of entries) {
      const path = entry.entity?.path ?? entry.path ?? "";
      const hasBase = Boolean(base[path]);
      if (entry.action === "created") {
        (hasBase ? held : apply).push(entry);
      } else if (entry.action === "updated") {
        (hasBase ? apply : held).push(entry);
      } else if (entry.action === "conflict" || entry.action === "removed") {
        held.push(entry);
      }
    }
    return { apply, held };
  };

  const notes = split(diff.entries as unknown as AnyEntry[]);
  const applyOut: FolderDiff = {
    ...diff,
    entries: notes.apply as unknown as FolderDiff["entries"],
    counts: countActions(notes.apply),
  };
  const heldOut: FolderDiff = {
    ...diff,
    entries: notes.held as unknown as FolderDiff["entries"],
    counts: countActions(notes.held),
  };

  if (diff.json) {
    const data = split(diff.json.entries as unknown as AnyEntry[]);
    applyOut.json = {
      ...diff.json,
      entries: data.apply as unknown as JsonDiff["entries"],
      counts: countActions(data.apply),
    } as JsonDiff;
    heldOut.json = {
      ...diff.json,
      entries: data.held as unknown as JsonDiff["entries"],
      counts: countActions(data.held),
    } as JsonDiff;
  }

  return { apply: applyOut, held: heldOut };
}

function countActions(entries: AnyEntry[]): Record<ImportAction, number> {
  const counts: Record<ImportAction, number> = {
    created: 0,
    updated: 0,
    unchanged: 0,
    conflict: 0,
    removed: 0,
  };
  for (const entry of entries) counts[entry.action] += 1;
  return counts;
}

/** What `applyOutsideEdits` needs from the app. */
export interface OutsideEditDeps {
  preview(): Promise<FolderDiff>;
  base(): Promise<Readonly<Record<string, string>>>;
  apply(diff: FolderDiff): Promise<unknown>;
  settle(held: FolderDiff): void;
}

/** Takes in the safe outside edits and leaves the rest for review. Returns how many of each. */
export async function applyOutsideEdits(
  deps: OutsideEditDeps,
): Promise<{ applied: number; held: number }> {
  const diff = await deps.preview();
  const base = await deps.base();
  const { apply, held } = splitOutsideEdits(diff, base);

  const applied = apply.entries.length + (apply.json?.entries.length ?? 0);
  if (applied > 0) await deps.apply(apply);
  deps.settle(held);

  return { applied, held: held.entries.length + (held.json?.entries.length ?? 0) };
}
