import { formatRelative } from "@/lib/format-date";
import type { LiveSyncState } from "./live-sync";

export type SyncDotState = "synced" | "syncing" | "offline" | "conflict" | "error";

/**
 * What the sync dot says (D-13): one state, a short label and the tooltip in
 * words. Conflicts outrank everything, since they are the only state that
 * needs the person. Null when this account does not sync and is online.
 */
export function syncStatus(
  s: Pick<LiveSyncState, "phase" | "enabled" | "isOnline" | "conflictsCount" | "lastSyncAt">,
  now: Date = new Date(),
): { state: SyncDotState; label: string; tip: string } | null {
  if (s.conflictsCount > 0) {
    const label = `${s.conflictsCount} conflict${s.conflictsCount === 1 ? "" : "s"}`;
    return { state: "conflict", label, tip: `${label} need you. Click to resolve.` };
  }
  if (!s.isOnline || s.phase === "offline") {
    return { state: "offline", label: "Offline", tip: "Offline. Changes are saved on this device and sync when you reconnect." };
  }
  if (!s.enabled) return null;
  if (s.phase === "syncing") return { state: "syncing", label: "Syncing…", tip: "Syncing changes with the cloud…" };
  if (s.phase === "error") {
    return { state: "error", label: "Sync failed", tip: "The last sync did not finish. Changes are safe on this device. Click to try again." };
  }
  const when = s.lastSyncAt ? formatRelative(s.lastSyncAt, now) : "";
  const ago = when === "Just now" ? " just now" : when ? ` ${when}` : "";
  return { state: "synced", label: "Synced", tip: `Synced${ago}. Click to sync now.` };
}
