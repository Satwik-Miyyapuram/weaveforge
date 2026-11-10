/**
 * Notes import helpers (Rust `vault::import_links`), re-exported from index.ts: the wikilink
 * rewrite after titles are auto-suffixed, and the file-name filter for an import.
 */
import {
  rewriteWikilinks as rawRewriteWikilinks,
  isNoteImportFile as rawIsNoteImportFile,
  withTagLine as rawWithTagLine,
  isMarkdownFile as rawIsMarkdownFile,
  isZipFile as rawIsZipFile,
  importRelativePath as rawImportRelativePath,
  planImportTitles as rawPlanImportTitles,
} from "../pkg/wf_wasm.js";

/** The titles an import gives its folders and notes, and the renames it made. */
export interface ImportTitlePlan {
  /** One title per folder key, in the order given. */
  readonly folderTitles: readonly string[];
  /** One title per note name, in the order given. */
  readonly noteTitles: readonly string[];
  /** Folders first, then notes, each whose title differs from its base name. */
  readonly renamed: readonly { readonly from: string; readonly to: string }[];
  /** Normalised base name to new title, for `rewriteWikilinks`. */
  readonly renameMap: ReadonlyMap<string, string>;
}

/** Decides the import titles for folder keys and note names against the existing titles. */
export function planImportTitles(
  folderKeys: readonly string[],
  noteNames: readonly string[],
  existingTitles: readonly string[],
): ImportTitlePlan {
  const raw = rawPlanImportTitles([...folderKeys], [...noteNames], [...existingTitles]);
  return {
    folderTitles: raw.folderTitles,
    noteTitles: raw.noteTitles,
    renamed: raw.renamed,
    renameMap: new Map(Object.entries(raw.renameMap)),
  };
}

/** The path an imported file is listed under; `webkitRelativePath` wins when it is non-empty. */
export function importRelativePath(webkitRelativePath: string, name: string): string {
  return rawImportRelativePath(webkitRelativePath, name);
}

/** Whether a picked file is a markdown note (`.md`, any case). */
export function isMarkdownFile(name: string): boolean {
  return rawIsMarkdownFile(name);
}

/** Whether a picked file is a `.zip` archive (any case). */
export function isZipFile(name: string): boolean {
  return rawIsZipFile(name);
}

/**
 * The body with its frontmatter tags written as a hashtag line, as the import writes it.
 * No tags leaves the body as it is.
 */
export function withTagLine(body: string, tags: readonly string[]): string {
  return rawWithTagLine(body, [...tags]);
}

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
