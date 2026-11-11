/**
 * Relay route URLs (Rust `relay_url`), re-exported from index.ts. The base is read
 * from the environment by the caller; this only joins and splits.
 */
export { relayPath, relayUrl } from "../pkg/wf_wasm.js";