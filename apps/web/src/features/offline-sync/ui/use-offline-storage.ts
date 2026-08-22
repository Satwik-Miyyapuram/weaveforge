"use client";

import { useCallback, useEffect, useState } from "react";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { LocalRunner } from "@/backend/providers/local/local-runner";
import { BlobCache, DEFAULT_OFFLINE_QUOTA, type BlobUsage } from "../domain/blob-cache";
import { OfflineScope } from "../domain/offline-scope";

/**
 * What this device keeps offline, as the settings screen sees it.
 *
 * Desktop-only, like the rest of sync: a browser tab has no disk of its own to
 * budget, so the screens that read this render nothing at all.
 */

export interface OfflineStorage {
  supported: boolean;
  usage: BlobUsage;
  projects: string[];
}

const NONE: OfflineStorage = {
  supported: false,
  usage: { bytes: 0, files: 0, quota: DEFAULT_OFFLINE_QUOTA },
  projects: [],
};

/** The disk the cache evicts from. The main process owns the files. */
function blobStorage() {
  const bridge = desktop() as { removeOfflineBlob?: (path: string) => Promise<void> } | null;
  return { remove: async (path: string) => void (await bridge?.removeOfflineBlob?.(path)) };
}

export function useOfflineStorage(): {
  storage: OfflineStorage;
  toggle: (projectId: string, on: boolean) => Promise<void>;
} {
  const [storage, setStorage] = useState<OfflineStorage>(NONE);

  const refresh = useCallback(() => {
    if (!desktop()) {
      setStorage(NONE);
      return;
    }
    const sql = new LocalRunner();
    const cache = new BlobCache(sql, blobStorage(), DEFAULT_OFFLINE_QUOTA);
    void Promise.all([cache.usage(), new OfflineScope(sql).list()])
      .then(([usage, projects]) => setStorage({ supported: true, usage, projects }))
      .catch(() => setStorage(NONE));
  }, []);

  useEffect(refresh, [refresh]);

  const toggle = useCallback(
    async (projectId: string, on: boolean) => {
      const sql = new LocalRunner();
      const scope = new OfflineScope(sql);
      await (on ? scope.enable(projectId) : scope.disable(projectId));
      // Switching a project off releases its files now rather than at the next
      // ceiling: a control whose effect is invisible reads as a control that
      // did nothing.
      if (!on) await new BlobCache(sql, blobStorage(), DEFAULT_OFFLINE_QUOTA).evict();
      refresh();
    },
    [refresh],
  );

  return { storage, toggle };
}
