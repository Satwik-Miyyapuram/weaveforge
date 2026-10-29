"use client";

import { useCallback, useEffect, useState } from "react";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";
import { LocalRunner } from "@/backend/providers/local/local-runner";
import { LOCAL_USER_ID } from "@weaveforge/core";
import { SyncEngine } from "../domain/sync-engine";
import { PostgrestTransport } from "../infra/postgrest-transport";
import { SyncStateStore } from "../domain/sync-state";
import { readBackendConfig } from "@/backend/config";

/**
 * Sync, as the settings screen sees it.
 *
 * Everything here is desktop-only and says so by returning nulls elsewhere: a
 * browser has no local database to adopt, so the screens that read this render nothing rather than a disabled control.
 */

export interface SyncStatus {
  supported: boolean;
  enabled: boolean;
  accountId: string | null;
  lastPullAt: string | null;
}

const OFF: SyncStatus = {
  supported: false,
  enabled: false,
  accountId: null,
  lastPullAt: null,
};

/**
 * This device's sync state. An unreadable local database is not a state the
 * reader can act on from a settings row, so it reads as "not available here";
 * the failure is logged so it is not mistaken for a browser.
 */
export async function readSyncStatus(state: Pick<SyncStateStore, "read">): Promise<SyncStatus> {
  try {
    const current = await state.read();
    return {
      supported: true,
      enabled: current.accountId !== null,
      accountId: current.accountId,
      lastPullAt: current.lastPullAt,
    };
  } catch (err) {
    logToApp({
      level: "warn",
      source: "offline-sync",
      message: "The local sync state could not be read",
      detail: formatError(err),
    });
    return OFF;
  }
}

export function useSyncStatus(): { status: SyncStatus; refresh: () => void } {
  const [status, setStatus] = useState<SyncStatus>(OFF);

  const refresh = useCallback(() => {
    const bridge = desktop();
    if (!bridge) {
      setStatus(OFF);
      return;
    }
    void readSyncStatus(new SyncStateStore(new LocalRunner())).then(setStatus);
  }, []);

  useEffect(refresh, [refresh]);

  return { status, refresh };
}

/** The engine, wired to this device's local database and the configured server. */
export function syncEngine(accessToken: () => Promise<string | null>): SyncEngine {
  const config = readBackendConfig();
  const transport = new PostgrestTransport({
    baseUrl: `${config.dataUrl ?? config.supabaseUrl ?? ""}/rest/v1`,
    apiKey: config.supabaseAnonKey ?? "",
    accessToken,
  });
  return new SyncEngine(new LocalRunner(), transport, LOCAL_USER_ID);
}
