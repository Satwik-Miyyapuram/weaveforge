import { formatRelative } from "@/lib/format-date";
import { readyCore } from "@/lib/rust-core";
import type { LiveSyncState } from "./live-sync";

export type { SyncDotState } from "@weaveforge/wasm";

/**
 * What the sync dot says (D-13): one state, a short label and the tooltip in
 * words. The wording and state rules live in Rust (`sync::sync_dot`); this
 * formats the last-sync time, which needs the browser's clock. Null when this
 * account does not sync and is online.
 */
export function syncStatus(
  s: Pick<LiveSyncState, "phase" | "enabled" | "isOnline" | "conflictsCount" | "lastSyncAt">,
  now: Date = new Date(),
) {
  return readyCore().syncDot({
    phase: s.phase,
    enabled: s.enabled,
    isOnline: s.isOnline,
    conflictsCount: s.conflictsCount,
    relativeLastSync: s.lastSyncAt ? formatRelative(s.lastSyncAt, now) : null,
  });
}
