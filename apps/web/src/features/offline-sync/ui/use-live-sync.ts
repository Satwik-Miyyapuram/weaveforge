"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getLiveSyncState,
  onLiveSyncChange,
  requestSync,
  type LiveSyncState,
} from "../domain/live-sync";

export function useLiveSync() {
  const [state, setState] = useState<LiveSyncState>(getLiveSyncState);

  useEffect(() => {
    return onLiveSyncChange(setState);
  }, []);

  const syncNow = useCallback(() => {
    requestSync();
  }, []);

  return {
    ...state,
    syncNow,
  };
}
