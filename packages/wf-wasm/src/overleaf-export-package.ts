/**
 * Overleaf export package steps (Rust `overleaf_export_package`), re-exported from index.ts:
 * the section walk that builds `main.tex`'s body, and the manifest rewrite for missing figures.
 * Object shapes come from ./bindings.ts where they exist; the walk and file types are declared here.
 */
import {
  walkOverleafSections as rawWalkOverleafSections,
  withMissingFigures as rawWithMissingFigures,
} from "../pkg/wf_wasm.js";
import type { ReportSectionTreeNode } from "./bindings.js";

/** A file in the export package: its path inside the package and its text. */
export interface OverleafExportFile {
  path: string;
  contents: string;
}

/** A binary figure to fetch and place under `figures/`. */
export interface OverleafExportImage {
  /** Storage path after `reportimg:` (ownerId/sectionId/file). */
  storagePath: string;
  /** Relative ZIP path, e.g. `figures/uuid.webp`. */
  zipPath: string;
}

/** Counts the section walk adds to the export stats. */
export interface OverleafWalkStats {
  sections: number;
  equationsApprox: number;
  figures: number;
}

/** The section walk's result. */
export interface OverleafSectionWalk {
  /** Body lines for `main.tex`. */
  out: string[];
  warnings: string[];
  images: OverleafExportImage[];
  stats: OverleafWalkStats;
}

/** Options for {@link walkOverleafSections}. */
export interface OverleafWalkOptions {
  includeNotes: boolean;
  /** Normalized paper title to bib key; when set, `[[wikilinks]]` become `\cite{key}`. */
  citeByTitle?: ReadonlyMap<string, string>;
}

/**
 * Walk the report outline into the `main.tex` body, warnings, figures and counts. Pure; the
 * Map is passed to Rust as a plain object.
 */
export function walkOverleafSections(
  tree: readonly ReportSectionTreeNode[],
  opts: OverleafWalkOptions,
): OverleafSectionWalk {
  const citeByTitle = opts.citeByTitle ? Object.fromEntries(opts.citeByTitle) : undefined;
  return rawWalkOverleafSections(tree, { includeNotes: opts.includeNotes, citeByTitle }) as OverleafSectionWalk;
}

/**
 * The files with `manifest.json` rewritten for figures whose blobs could not be loaded. Rust
 * returns a new array; the app wrapper keeps the no-missing identity.
 */
export function withMissingFigures(
  files: readonly OverleafExportFile[],
  missing: readonly OverleafExportImage[],
): OverleafExportFile[] {
  return rawWithMissingFigures(files, missing) as OverleafExportFile[];
}
