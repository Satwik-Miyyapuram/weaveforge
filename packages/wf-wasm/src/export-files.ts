/**
 * User-data export file pieces (Rust `export_files`): the manifest, the README and the
 * folder a stored asset is written to. The snapshot reads and blob fetches stay in the web app.
 */
import type {
  ExportStats,
} from "./bindings.js";

export {
  exportAssetPath,
  exportManifestJson,
  exportReadme,
} from "../pkg/wf_wasm.js";

export type { ExportStats } from "./bindings.js";

