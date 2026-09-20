"use client";

import dynamic from "next/dynamic";

/**
 * Lazy boundary for the sync loop.
 *
 * The loop pulls in the engine, the PostgREST transport and the Supabase client,
 * and the shell mounts it on **every** route — so it is code-split out of all of
 * them and fetched after hydration. It renders nothing either way, which is why
 * there is no loading state to show.
 *
 * `SyncLoop` is a named export, so the `.then` is not optional.
 */
const LazySyncLoop = dynamic(() => import("./sync-loop").then((m) => m.SyncLoop), { ssr: false });

export function SyncLoop() {
  return <LazySyncLoop />;
}
