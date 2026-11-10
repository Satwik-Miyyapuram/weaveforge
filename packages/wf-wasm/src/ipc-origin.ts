/**
 * IPC origin comparison (Rust `ipc_origin`), re-exported from index.ts. Electron event wiring stays in TypeScript.
 */
import { originOf as rawOriginOf, sameOrigin as rawSameOrigin } from "../pkg/wf_wasm.js";

/** Whether `url` is the same origin as `origin`; an unparseable side is never the same. */
export function sameOrigin(url: string, origin: string): boolean {
  return rawSameOrigin(url, origin);
}

/** The `scheme://host[:port]` origin of `url`, or `null` when it does not parse. */
export function originOf(url: string): string | null {
  return rawOriginOf(url) ?? null;
}
