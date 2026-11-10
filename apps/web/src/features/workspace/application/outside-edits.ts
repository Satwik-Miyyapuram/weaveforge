/**
 * An outside edit (made in the connected folder by another program) is taken in
 * without asking only when the folder alone changed that file since the two sides
 * last agreed, and the note is not open in an editor. A JSON data file goes in
 * whole or not at all. Everything else stays for a person to review: changes made
 * on both sides (even when they merge cleanly), removals, files with no record of
 * the last agreement, and open notes.
 *
 * The decision is in Rust (`workspace::outside_edits`); this module gathers the
 * changed entries and the app's open notes, and applies the result.
 */
import type { ChangeSide, JsonDiff } from "@weaveforge/core";
import type { HeldReason, ImportDiff, ImportDiffEntry } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";

/** What the preview saw of one folder file: who moved it since the sides last agreed, and its digest then. */
export interface SeenFile {
  side: ChangeSide;
  digest: string;
  /** Neither the last agreement nor the workspace knows this path: a new file, or a copy of a known one. */
  newPath?: boolean;
  /** Where the note this new path carries lived, when that file is gone: a rename, not a copy. */
  renamedFrom?: string;
}

export type FolderDiff = ImportDiff & {
  json?: JsonDiff;
  seen?: Readonly<Record<string, SeenFile>>;
  /** Each note's stored title and body digest when the preview was taken, by id (`storedDigest`). */
  stored?: Readonly<Record<string, string>>;
};

export type { HeldReason };

/** Held files by path, each with the first reason that holds it. */
export type HeldReasons = Readonly<Record<string, HeldReason>>;

/** Paths of renamed notes in a diff, for the apply to retitle and hand back to the mirror. */
export function renamedPaths(diff: FolderDiff): Set<string> {
  return new Set(
    readyCore().renamedOutsidePaths(
      diff.seen ?? {},
      diff.entries.map((entry) => entry.entity.path),
    ),
  );
}

/** The part of a folder diff safe to take in without asking, the part a person must see, and why. */
export function splitOutsideEdits(
  diff: FolderDiff,
  isOpen: (noteId: string) => boolean = () => false,
): { apply: FolderDiff; held: FolderDiff; reasons: HeldReasons } {
  const notes: ImportDiffEntry[] = diff.entries.filter((entry) => entry.action !== "unchanged");
  const rows = diff.json?.entries.filter((entry) => entry.action !== "unchanged") ?? [];

  const split = readyCore().splitOutsideEdits({
    notes: notes.map((entry) => {
      const id = entry.entity.id;
      return {
        action: entry.action,
        path: entry.entity.path,
        open: id ? isOpen(id) : false,
      };
    }),
    rows: rows.map((entry) => ({ action: entry.action, path: entry.path })),
    seen: diff.seen ?? {},
  });

  const apply = notes.filter((_, i) => !split.noteHeld[i]);
  const held = notes.filter((_, i) => split.noteHeld[i]);
  const applyOut: FolderDiff = {
    ...diff,
    entries: apply,
    counts: readyCore().countActionList(apply.map((entry) => entry.action)),
  };
  const heldOut: FolderDiff = {
    ...diff,
    entries: held,
    counts: readyCore().countActionList(held.map((entry) => entry.action)),
  };

  if (diff.json) {
    const jsonApply = rows.filter((_, i) => !split.rowHeld[i]);
    const jsonHeld = rows.filter((_, i) => split.rowHeld[i]);
    applyOut.json = {
      ...diff.json,
      entries: jsonApply,
      counts: readyCore().countActionList(jsonApply.map((entry) => entry.action)),
    };
    heldOut.json = {
      ...diff.json,
      entries: jsonHeld,
      counts: readyCore().countActionList(jsonHeld.map((entry) => entry.action)),
    };
  }

  return { apply: applyOut, held: heldOut, reasons: split.reasons };
}

/** What `applyOutsideEdits` needs from the app. */
export interface OutsideEditDeps {
  preview(): Promise<FolderDiff>;
  /** True for a note open in an editor: its edits wait for review rather than land under the cursor. */
  isOpen(noteId: string): boolean;
  /** `moved`: paths not applied because their note changed in the app after the preview. */
  apply(diff: FolderDiff): Promise<{ moved?: readonly string[] } | void>;
  settle(held: FolderDiff): void;
}

/** Takes in the safe outside edits and leaves the rest for review. Returns how many of each. */
export async function applyOutsideEdits(
  deps: OutsideEditDeps,
): Promise<{ applied: number; held: number }> {
  const diff = await deps.preview();
  const { apply, held } = splitOutsideEdits(diff, (noteId) => deps.isOpen(noteId));

  let applied = apply.entries.length + (apply.json?.entries.length ?? 0);
  if (applied > 0) applied -= (await deps.apply(apply))?.moved?.length ?? 0;
  deps.settle(held);

  return { applied, held: held.entries.length + (held.json?.entries.length ?? 0) };
}
