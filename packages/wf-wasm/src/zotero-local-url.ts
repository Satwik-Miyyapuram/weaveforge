/**
 * Local Zotero API URL check (Rust `zotero_local_url`), re-exported from index.ts.
 */
import { isLocalZoteroUrl as rawIsLocalZoteroUrl } from "../pkg/wf_wasm.js";

/** True only for a URL on the local Zotero API's own path, with no credentials. */
export function isLocalZoteroUrl(url: string): boolean {
  return rawIsLocalZoteroUrl(url);
}
