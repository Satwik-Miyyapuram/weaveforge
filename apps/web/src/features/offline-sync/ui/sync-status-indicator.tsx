"use client";

import { usePathname, useRouter } from "next/navigation";
import { useLiveSync } from "./use-live-sync";
import { setLiveSyncState } from "../domain/live-sync";
import { desktop } from "@/lib/desktop/desktop-bridge";

/** `attentionOnly`: render only states the person must act on (offline work, conflicts). */
export function SyncStatusIndicator({ attentionOnly = false }: { attentionOnly?: boolean } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    phase,
    enabled,
    isOnline,
    conflictsCount,
    lastSyncAt,
    lastAdoption,
    syncNow,
  } = useLiveSync();

  // Desktop only
  if (!desktop()) return null;

  if (conflictsCount > 0) {
    return (
      <button
        type="button"
        className="sync-badge conflict"
        onClick={() => {
          // Same-page push does not fire hashchange; setting the hash does, and Settings listens.
          if (pathname === "/settings") window.location.hash = "settings-sync";
          else router.push("/settings#settings-sync");
        }}
        title={`${conflictsCount} conflict${conflictsCount === 1 ? "" : "s"} require your attention. Click to resolve.`}
      >
        <span className="sync-dot amber" />
        <span>Conflicts ({conflictsCount})</span>
      </button>
    );
  }

  if (attentionOnly) return null;

  // Signing in merged this device's branch into the account's; say so once.
  if (lastAdoption && lastAdoption.claimed + lastAdoption.queued + lastAdoption.renamed.length > 0) {
    const renamed = lastAdoption.renamed;
    return (
      <button
        type="button"
        className="sync-badge merged"
        onClick={() => setLiveSyncState({ lastAdoption: null })}
        title={
          (renamed.length > 0
            ? `Renamed to avoid clashing with your account:\n${renamed.map((r) => `${r.from} → ${r.to}`).join("\n")}\n`
            : "") + "Click to dismiss."
        }
      >
        <span className="sync-dot green" />
        <span>
          Merged with your account{renamed.length > 0 ? ` · ${renamed.length} renamed` : ""}
        </span>
        <span aria-hidden="true">×</span>
      </button>
    );
  }

  if (phase === "syncing") {
    return (
      <span className="sync-badge syncing" title="Syncing changes with cloud…">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="sync-spin-icon"
          style={{ width: "12px", height: "12px" }}
        >
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3" />
        </svg>
        <span>Syncing…</span>
      </span>
    );
  }

  if (!isOnline || phase === "offline") {
    return (
      <span
        className="sync-badge offline"
        title="Working offline. All changes are saved safely to your local computer and will sync when reconnected."
      >
        <span className="sync-dot muted" />
        <span>Offline</span>
      </span>
    );
  }

  if (enabled) {
    const timeStr = lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
    return (
      <button
        type="button"
        className="sync-badge synced"
        onClick={syncNow}
        title={timeStr ? `All changes synced (last at ${timeStr}). Click to sync now.` : "All changes synced. Click to sync now."}
      >
        <span className="sync-dot green" />
        <span>Synced</span>
      </button>
    );
  }

  return null;
}
