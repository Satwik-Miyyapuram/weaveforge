export {
  bearerToken,
  isLegacyTokenHex,
  isLoopbackHost,
} from "../pkg/wf_wasm.js";
/**
 * Local API request guards (Rust `local_api_guard`), re-exported from index.ts. Token hashing and the
 * constant-time compare stay in TypeScript.
 */

