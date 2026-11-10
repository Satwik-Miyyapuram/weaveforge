/**
 * IPC origin comparison (Rust `ipc_origin`), re-exported from index.ts. Electron event wiring stays in TypeScript.
 */
import {
  originOf as rawOriginOf,
} from "../pkg/wf_wasm.js";

export {
  sameOrigin,
} from "../pkg/wf_wasm.js";

/** The `scheme://host[:port]` origin of `url`, or `null` when it does not parse. */
export function originOf(url: string): string | null {
  return rawOriginOf(url) ?? null;
}
