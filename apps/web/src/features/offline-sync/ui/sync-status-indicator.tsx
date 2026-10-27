"use client";

import { usePathname, useRouter } from "next/navigation";
import { useLiveSync } from "./use-live-sync";
import { setLiveSyncState } from "../domain/live-sync";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { RowButton } from "@/components/controls";
import { syncStatus } from "../domain/sync-status";

const DOT = { synced: "green", offline: "muted", conflict: "amber", syncing: "" } as const;

/** `attentionOnly`: render only conflicts, the one state that needs the person. */
export function SyncStatusIndicator({ attentionOnly = false }: { attentionOnly?: boolean } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const live = useLiveSync();
  const { lastAdoption, syncNow } = live;

  // Desktop only
  if (!desktop()) return null;
  const status = syncStatus(live);
  if (!status) return null;

  if (status.state === "conflict") {
    return (
      <RowButton
        className="sync-badge conflict"
        onClick={() => {
          // Same-page push does not fire hashchange; setting the hash does, and Settings listens.
          if (pathname === "/settings") window.location.hash = "settings-sync";
          else router.push("/settings#settings-sync");
        }}
        title={status.tip}
      >
        <span className="sync-dot amber" />
        <span>{status.label}</span>
      </RowButton>
    );
  }

  if (attentionOnly) return null;

  // Signing in merged this device's branch into the account's; say so once.
  if (lastAdoption && lastAdoption.claimed + lastAdoption.queued + lastAdoption.renamed.length > 0) {
    const renamed = lastAdoption.renamed;
    return (
      <RowButton
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
      </RowButton>
    );
  }

  const mark =
    status.state === "syncing" ? (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="sync-spin-icon"
        aria-hidden="true"
        style={{ width: "12px", height: "12px" }}
      >
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3" />
      </svg>
    ) : (
      <span className={`sync-dot ${DOT[status.state]}`} />
    );
  const className = `sync-badge ${status.state}`;
  const label = <span>{status.label}</span>;

  if (status.state === "synced") {
    return (
      <RowButton className={className} onClick={syncNow} title={status.tip} aria-label={status.tip}>
        {mark}
        {label}
      </RowButton>
    );
  }
  return (
    <span className={className} role="status" title={status.tip} aria-label={status.tip}>
      {mark}
      {label}
    </span>
  );
}
