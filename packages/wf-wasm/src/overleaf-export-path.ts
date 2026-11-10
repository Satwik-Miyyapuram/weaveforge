/**
 * Export path guard and missing-figure warning (Rust `overleaf::export_path`), re-exported from
 * index.ts. The guard throws, as the TS helper it replaces did.
 */
import {
  missingFigureWarning as rawMissingFigureWarning,
  assertSafeExportPath as rawUnsafeExportPathError,
} from "../pkg/wf_wasm.js";

/** Throws unless `path` is a plain relative ZIP entry name: no `..`, no leading `/`, no `\`. */
export function assertSafeExportPath(path: string): void {
  const error = rawUnsafeExportPathError(path);
  if (error) throw new Error(error);
}

/** The warning for a figure whose blob could not be loaded. */
export function missingFigureWarning(img: { zipPath: string; storagePath: string }): string {
  return rawMissingFigureWarning(img.zipPath, img.storagePath);
}
