/**
 * Local API request guards (Rust `local_api_guard`), re-exported from index.ts. Token hashing and the
 * constant-time compare stay in TypeScript.
 */
import {
  bearerToken as rawBearerToken,
  isLegacyTokenHex as rawIsLegacyTokenHex,
  isLoopbackHost as rawIsLoopbackHost,
} from "../pkg/wf_wasm.js";

/** Whether a `Host` header names this machine on `port` (127.0.0.1, localhost or [::1]). */
export function isLoopbackHost(host: string | undefined, port: number): boolean {
  return rawIsLoopbackHost(host, port);
}

/** The credential a `Bearer` authorization header offers, or `undefined` when there is none. */
export function bearerToken(header: string | undefined): string | undefined {
  return rawBearerToken(header);
}

/** Whether a stored token string is a legacy plaintext token (64 lowercase hex characters). */
export function isLegacyTokenHex(stored: string): boolean {
  return rawIsLegacyTokenHex(stored);
}
