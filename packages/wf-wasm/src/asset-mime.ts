/**
 * Asset content type and extension rules (Rust `asset_mime`), re-exported from index.ts.
 * Replaces the former helpers in apps/web/src/features/workspace/application/asset-reanchor.ts.
 */
import { assetExtension as rawAssetExtension, assetMimeType as rawAssetMimeType } from "../pkg/wf_wasm.js";

/** Content type for an imported asset, from its extension. SVG and unknown types are `application/octet-stream`. */
export function assetMimeType(ext: string): string {
  return rawAssetMimeType(ext);
}

/** Lowercased extension of a path, defaulting to `png` when there is none. */
export function assetExtension(path: string): string {
  return rawAssetExtension(path);
}
