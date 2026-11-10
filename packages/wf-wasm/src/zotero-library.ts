/**
 * Zotero Web API library helpers (Rust `zotero_library`), re-exported from index.ts.
 * Keeps the results of the helpers in apps/web/src/features/papers/infrastructure/zotero-web-api.ts.
 */
import {
  normalizeZoteroLibrary as rawNormalizeZoteroLibrary,
  zoteroTopLevelPath as rawZoteroTopLevelPath,
} from "../pkg/wf_wasm.js";

export {
  isZoteroChildItem,
  zoteroHeaders,
  zoteroLibraryUrl,
} from "../pkg/wf_wasm.js";

/** The library path for a pasted library id or path, or undefined when it is not one. */
export function normalizeZoteroLibrary(library: string | undefined): string | undefined {
  return (rawNormalizeZoteroLibrary(library) as string | null) ?? undefined;
}

/** The top-level items path, inside the collection when a key is given. */
export function zoteroTopLevelPath(collection?: string): string {
  return rawZoteroTopLevelPath(collection);
}
