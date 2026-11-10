/**
 * Sync connection field visibility (Rust `sync_fields`). The filtering over the
 * app's field objects stays in the web app; this answers per field key.
 */
import { syncFieldShown as rawSyncFieldShown } from "../pkg/wf_wasm.js";

/** Whether the connection field with `key` is asked for in this sign-in mode. */
export function syncFieldShown(key: string, mattermostSignIn: boolean): boolean {
  return rawSyncFieldShown(key, mattermostSignIn);
}
