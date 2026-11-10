/**
 * The account menu's sync dot: state, label and tooltip (Rust `sync::sync_dot`).
 * Timers and the live state stay in TypeScript; the wording and state rules live here.
 */
import { syncDot as rawSyncDot } from "../pkg/wf_wasm.js";
import type { SyncDot, SyncDotInput } from "./bindings.js";

export type { SyncDot, SyncDotInput, SyncDotState } from "./bindings.js";

/** The dot for this state, or `null` when this account does not sync and is online. */
export function syncDot(input: SyncDotInput): SyncDot | null {
  return (rawSyncDot(input) as SyncDot | undefined) ?? null;
}
