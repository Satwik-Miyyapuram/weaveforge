import type { OfflineChangeSummary } from "./adoption";

export type SyncPhase = "idle" | "syncing" | "offline" | "error" | "needs-adoption";

export interface LiveSyncState {
  phase: SyncPhase;
  enabled: boolean;
  isOnline: boolean;
  accountId: string | null;
  lastSyncAt: number | null;
  conflictsCount: number;
  offlineWorkCount: number;
  offlineSummary: OfflineChangeSummary | null;
}

const defaultState: LiveSyncState = {
  phase: typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "idle",
  enabled: false,
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  accountId: null,
  lastSyncAt: null,
  conflictsCount: 0,
  offlineWorkCount: 0,
  offlineSummary: null,
};

let currentState: LiveSyncState = { ...defaultState };
const listeners = new Set<(state: LiveSyncState) => void>();
let registeredTrigger: (() => void) | null = null;

export function getLiveSyncState(): LiveSyncState {
  return currentState;
}

export function setLiveSyncState(partial: Partial<LiveSyncState>): void {
  currentState = { ...currentState, ...partial };
  for (const listener of [...listeners]) {
    try {
      listener(currentState);
    } catch {
      // Listener errors must not interrupt state updates
    }
  }
}

export function onLiveSyncChange(listener: (state: LiveSyncState) => void): () => void {
  listeners.add(listener);
  listener(currentState);
  return () => {
    listeners.delete(listener);
  };
}

export function registerSyncTrigger(trigger: () => void): () => void {
  registeredTrigger = trigger;
  return () => {
    if (registeredTrigger === trigger) {
      registeredTrigger = null;
    }
  };
}

export function requestSync(): void {
  registeredTrigger?.();
}
