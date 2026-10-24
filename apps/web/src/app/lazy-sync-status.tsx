"use client";

import dynamic from "next/dynamic";

// Lazy: pulls the local database client, which only the desktop build has.
export const SyncStatusIndicator = dynamic(
  () => import("@/features/offline-sync/ui/sync-status-indicator").then((m) => m.SyncStatusIndicator),
  { ssr: false },
);
