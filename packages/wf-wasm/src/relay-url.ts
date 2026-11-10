/**
 * Relay route URLs (Rust `relay_url`), re-exported from index.ts. The base is read
 * from the environment by the caller; this only joins and splits.
 */
import { relayPath as rawRelayPath, relayUrl as rawRelayUrl } from "../pkg/wf_wasm.js";

/** The URL a browser requests for relay route `path`; `base` null means relay routing is off. */
export function relayUrl(base: string | null, path: string): string {
  return rawRelayUrl(base ?? undefined, path);
}

/** The relay route path inside `url`; `url` unchanged when it is not under `base`. */
export function relayPath(base: string | null, url: string): string {
  return rawRelayPath(base ?? undefined, url);
}
