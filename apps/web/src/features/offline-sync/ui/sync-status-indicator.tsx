"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useLiveSync } from "./use-live-sync";
import { desktop } from "@/lib/desktop/desktop-bridge";

const OfflineWorkModal = dynamic(
  () => import("./offline-work-modal").then((m) => m.OfflineWorkModal),
  { ssr: false },
);

export function SyncStatusIndicator() {
  const router = useRouter();
  const {
    phase,
    enabled,
    isOnline,
    conflictsCount,
    offlineWorkCount,
    lastSyncAt,
    syncNow,
  } = useLiveSync();

  const [modalOpen, setModalOpen] = useState(false);

  // Desktop only
  if (!desktop()) return null;

  if (phase === "needs-adoption" && offlineWorkCount > 0) {
    return (
      <>
        <button
          type="button"
          className="sync-badge needs-adoption"
          onClick={() => setModalOpen(true)}
          title="You have offline work from before signing in. Click to review and sync."
        >
          <span className="sync-dot amber" />
          <span>Offline work ({offlineWorkCount})</span>
        </button>
        <OfflineWorkModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
      </>
    );
  }

  if (conflictsCount > 0) {
    return (
      <button
        type="button"
        className="sync-badge conflict"
        onClick={() => router.push("/settings")}
        title={`${conflictsCount} conflict${conflictsCount === 1 ? "" : "s"} require your attention. Click to resolve.`}
      >
        <span className="sync-dot amber" />
        <span>Conflicts ({conflictsCount})</span>
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
