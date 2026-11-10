/**
 * Whether the operating system may open a URL (Rust `net::open_external`), re-exported from index.ts.
 * Keeps the signature of apps/desktop/src/handlers.ts.
 */
import { mayOpenExternally as rawMayOpenExternally } from "../pkg/wf_wasm.js";

/**
 * True for a plain web address with no credentials on an allowed port that is not a private host.
 * Scheme-less input is read as https, as `checkUrlShape` (via `parseUserUrl`) did, so `example.com` passes.
 */
export function mayOpenExternally(url: string): boolean {
  return rawMayOpenExternally(url);
}
