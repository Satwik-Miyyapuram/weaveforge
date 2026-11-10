/**
 * Folder-diff helpers (Rust `workspace::folder_diff`): renames of note files in the
 * connected folder, and what each folder file said since the sides last agreed.
 */
import {
  importableEntities as rawImportableEntities,
  renameSources as rawRenameSources,
  seenFiles as rawSeenFiles,
} from "../pkg/wf_wasm.js";
import type { ChangeSide, FolderParsedEntity, ParsedEntity } from "./bindings.js";

export type { FolderParsedEntity } from "./bindings.js";

/** What one folder file said: who moved it since the sides last agreed, and its digest now. */
export interface FolderSeenFile {
  side: ChangeSide;
  digest: string;
  newPath?: boolean;
  renamedFrom?: string;
}

/** New folder paths that are renames, mapped to the old path. */
export function renameSources(
  parsed: readonly FolderParsedEntity[],
  folder: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>,
): Record<string, string> {
  return rawRenameSources(parsed, folder, current) as Record<string, string>;
}

/** The folder files a folder import may bring in: vault pages, and files whose note id is in `noteIds`. */
export function importableEntities(
  entities: readonly ParsedEntity[],
  noteIds: ReadonlySet<string>,
): ParsedEntity[] {
  return rawImportableEntities(entities, [...noteIds]) as ParsedEntity[];
}

/** Who moved each folder file since the two sides last agreed, keyed by path. */
export function seenFiles(
  folder: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>,
  base: Readonly<Record<string, string>>,
  renamed: Readonly<Record<string, string>>,
): Record<string, FolderSeenFile> {
  return rawSeenFiles(folder, current, base, renamed) as Record<string, FolderSeenFile>;
}
