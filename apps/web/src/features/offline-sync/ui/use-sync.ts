"use client";

import { useCallback, useEffect, useState } from "react";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { LocalRunner } from "@/backend/providers/local/local-runner";
import { LOCAL_USER_ID } from "@weaveforge/core";
import { SyncEngine } from "../domain/sync-engine";
import { PostgrestTransport } from "../infra/postgrest-transport";
import { SyncStateStore } from "../domain/sync-state";
import { neverOffered, preferenceMemory, shouldOfferSync } from "../application/sync-offer";
import { readBackendConfig } from "@/backend/config";

/**
 * Sync, as the settings screen sees it.
 *
 * Everything here is desktop-only and says so by returning nulls elsewhere: a
 * browser has no local database to adopt and no shell to remember the offer,
 * so the screens that read this render nothing rather than a disabled control.
 */

export interface SyncStatus {
  supported: boolean;
  enabled: boolean;
  accountId: string | null;
  lastPullAt: string | null;
  /** Whether the one-time opt-in card should be shown. */
  offer: boolean;
}

const OFF: SyncStatus = {
  supported: false,
  enabled: false,
  accountId: null,
  lastPullAt: null,
  offer: false,
};

export function useSyncStatus(): { status: SyncStatus; refresh: () => void; dismissOffer: () => void } {
  const [status, setStatus] = useState<SyncStatus>(OFF);

  const refresh = useCallback(() => {
    const bridge = desktop();
    if (!bridge) {
      setStatus(OFF);
      return;
    }
    const state = new SyncStateStore(new LocalRunner());
    void state
      .read()
      .then(async (current) => {
        const offer = await shouldOfferSync({
          memory: preferenceMemory(bridge),
          enabled: async () => current.accountId !== null,
        });
        setStatus({
          supported: true,
          enabled: current.accountId !== null,
          accountId: current.accountId,
          lastPullAt: current.lastPullAt,
          offer,
        });
      })
      .catch(() => {
        // An unreadable local database is not a state the reader can act on
        // from a settings row; it reads as "not available here".
        setStatus(OFF);
      });
  }, []);

  useEffect(refresh, [refresh]);

  const dismissOffer = useCallback(() => {
    const bridge = desktop();
    const memory = bridge ? preferenceMemory(bridge) : neverOffered;
    void memory.markShown();
    setStatus((s) => ({ ...s, offer: false }));
  }, []);

  return { status, refresh, dismissOffer };
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
