"use client";

/**
 * The status bar's git sync dot: whether the workspace folder is in step with
 * its remote. It reads the engine the app runs (`auto-sync.ts`) and paints
 * nothing when auto-sync is off: no folder, no remote, or no token.
 */

import { useSyncExternalStore } from "react";

import { Button } from "@/components/button";

import { autoSyncView, onAutoSyncView, retryAutoSync, type AutoSyncState } from "../application/auto-sync";

export type SyncDot = { tone: "good" | "info" | "muted" | "danger"; text: string; label: string };

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** What the dot says for a state; null when it is not shown. */
export function syncDot(state: AutoSyncState, time: (at: number) => string = clock): SyncDot | null {
  switch (state.kind) {
    case "off":
      return null;
    case "idle":
      return {
        tone: "good",
        text: `Synced ${time(state.syncedAt)}${state.pulled ? " · pulled changes" : ""}`,
        label: `Git sync: synced at ${time(state.syncedAt)}${state.pulled ? ", and changes came in" : ""}.`,
      };
    case "syncing":
      return { tone: "info", text: "Syncing…", label: "Git sync: syncing." };
    case "offline":
      return { tone: "muted", text: "Offline", label: "Git sync: offline. It syncs when you are back online." };
    case "error":
      return { tone: "danger", text: "Sync failed", label: `Git sync failed: ${state.message} Next try at ${time(state.retryAt)}.` };
  }
}

export function GitSyncDotView({
  state,
  onRetry,
  time,
}: {
  state: AutoSyncState;
  onRetry: () => void;
  time?: (at: number) => string;
}) {
  const dot = syncDot(state, time);
  if (!dot) return null;
  return (
    <span className="status-bar-sync" data-tone={dot.tone}>
      <span role="status" aria-label={dot.label} title={dot.label}>
        <span className="status-bar-dot" aria-hidden="true" />
        {dot.text}
      </span>
      {state.kind === "error" ? (
        <Button variant="link" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </span>
  );
}

const OFF: AutoSyncState = { kind: "off" };

export function GitSyncDot() {
  const state = useSyncExternalStore(onAutoSyncView, autoSyncView, () => OFF);
  return <GitSyncDotView state={state} onRetry={retryAutoSync} />;
}
