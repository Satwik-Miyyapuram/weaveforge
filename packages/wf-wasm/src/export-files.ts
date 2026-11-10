/**
 * User-data export file pieces (Rust `export_files`): the manifest, the README and the
 * folder a stored asset is written to. The snapshot reads and blob fetches stay in the web app.
 */
import {
  exportManifestJson as rawExportManifestJson,
  exportReadme as rawExportReadme,
  exportAssetPath as rawExportAssetPath,
} from "../pkg/wf_wasm.js";
import type { ExportStats } from "./bindings.js";

export type { ExportStats } from "./bindings.js";

/** The export's `manifest.json` text, pretty-printed with two-space indent. */
export function exportManifestJson(exportedAt: string, stats: ExportStats): string {
  return rawExportManifestJson(exportedAt, stats);
}

/** The export's `README.txt` text, stamped with the export time. */
export function exportReadme(exportedAt: string): string {
  return rawExportReadme(exportedAt);
}

/** The export path of a stored asset: `{root}/{prefix}/{id}/{name}`. */
export function exportAssetPath(root: string, prefix: string, storagePath: string): string {
  return rawExportAssetPath(root, prefix, storagePath);
}
