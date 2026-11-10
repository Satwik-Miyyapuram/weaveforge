/**
 * Vault folder and search rules (Rust `vault_search`), re-exported from index.ts. Walks, reads, realpath and
 * mkdir stay in TypeScript.
 */
import {
  chooseRoot as rawChooseRoot,
  isSearchFile as rawIsSearchFile,
  isSkippedDir as rawIsSkippedDir,
  isTemporaryName as rawIsTemporaryName,
  rootVerdict as rawRootVerdict,
  searchMatches as rawSearchMatches,
  temporaryName as rawTemporaryName,
} from "../pkg/wf_wasm.js";

/** The lines of `text` that contain `query` ignoring case, cut for display, at most five. */
export function searchMatches(text: string, query: string): string[] {
  return rawSearchMatches(text, query);
}

/** Whether the search reads this file (a markdown file, by its exact lowercase extension). */
export function isSearchFile(path: string): boolean {
  return rawIsSearchFile(path);
}

/** Whether the walk skips this directory (its last segment starts with a dot). */
export function isSkippedDir(path: string): boolean {
  return rawIsSkippedDir(path);
}

export type RootVerdict = "notADirectory" | "existing" | "empty" | "notEmpty";
export type RootChoice = "use" | "nest" | "refuse";

/** The verdict on a chosen folder, from whether it is a directory, the names inside it and the workspace mark. */
export function rootVerdict(isDir: boolean, entries: string[], metaDir: string): RootVerdict {
  return rawRootVerdict(isDir, entries, metaDir) as RootVerdict;
}

/** What to do with a chosen folder given its verdict. */
export function chooseRoot(verdict: RootVerdict): RootChoice {
  return rawChooseRoot(verdict) as RootChoice;
}

/** The staged name a write to `target` is renamed from. */
export function temporaryName(target: string, pid: number, seq: number): string {
  return rawTemporaryName(target, pid, seq);
}

/** Whether a directory listing must skip this staged-write entry. */
export function isTemporaryName(name: string): boolean {
  return rawIsTemporaryName(name);
}
