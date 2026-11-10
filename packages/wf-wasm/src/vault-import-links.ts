/**
 * Notes import helpers (Rust `vault::import_links`), re-exported from index.ts: the wikilink
 * rewrite after titles are auto-suffixed, and the file-name filter for an import.
 */
import {
  rewriteWikilinks as rawRewriteWikilinks,
  isNoteImportFile as rawIsNoteImportFile,
} from "../pkg/wf_wasm.js";

/**
 * Rewrite `[[Old]]`, `[[Old|alias]]` and `[[Old#heading]]` when import renamed `Old`. `renames`
 * maps a normalised old title to its new title.
 */
export function rewriteWikilinks(body: string, renames: ReadonlyMap<string, string>): string {
  return rawRewriteWikilinks(body, Object.fromEntries(renames));
}

/** A file the notes import reads: markdown, or a `.zip` of it. */
export function isNoteImportFile(name: string): boolean {
  return rawIsNoteImportFile(name);
}
