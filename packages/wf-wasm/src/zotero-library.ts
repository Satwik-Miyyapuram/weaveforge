/**
 * Zotero Web API library helpers (Rust `zotero_library`), re-exported from index.ts.
 * Keeps the results of the helpers in apps/web/src/features/papers/infrastructure/zotero-web-api.ts.
 */
import {
  isZoteroChildItem as rawIsZoteroChildItem,
  normalizeZoteroLibrary as rawNormalizeZoteroLibrary,
  zoteroHeaders as rawZoteroHeaders,
  zoteroLibraryUrl as rawZoteroLibraryUrl,
  zoteroTopLevelPath as rawZoteroTopLevelPath,
} from "../pkg/wf_wasm.js";

/** True when the item is an attachment, note or annotation, or has a parent item. */
export function isZoteroChildItem(item: unknown): boolean {
  return rawIsZoteroChildItem(item);
}

/** The library path for a pasted library id or path, or undefined when it is not one. */
export function normalizeZoteroLibrary(library: string | undefined): string | undefined {
  return (rawNormalizeZoteroLibrary(library) as string | null) ?? undefined;
}

/** The headers every Zotero Web API request carries: the API key and the API version. */
export function zoteroHeaders(apiKey: string): Record<string, string> {
  return rawZoteroHeaders(apiKey) as Record<string, string>;
}

/** The API URL for a library path under an origin. */
export function zoteroLibraryUrl(library: string, apiOrigin: string): string {
  return rawZoteroLibraryUrl(library, apiOrigin);
}

/** The top-level items path, inside the collection when a key is given. */
export function zoteroTopLevelPath(collection?: string): string {
  return rawZoteroTopLevelPath(collection);
}
