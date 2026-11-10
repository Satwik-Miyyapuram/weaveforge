/**
 * API-host check (Rust `net::api_host`), re-exported from index.ts.
 * Keeps the signature of apps/desktop/src/api-cors.ts.
 */
import { isApiHost as rawIsApiHost } from "../pkg/wf_wasm.js";

/** True when the URL's host is `weaveforge.org` or a subdomain of it. False for text that does not parse. */
export function isApiHost(url: string): boolean {
  return rawIsApiHost(url);
}
