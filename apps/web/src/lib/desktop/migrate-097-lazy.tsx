"use client";

import dynamic from "next/dynamic";

/**
 * Lazy boundary for the 0.9.7 upgrade gate.
 *
 * The gate pulls in the whole exporter, and the layout mounts it on **every**
 * route, so it is code-split out of all of them and fetched after hydration.
 * It renders beside the app, never around it: the gate only adds banners and
 * the upgrade screen, so there is no loading state to show.
 *
 * `Migrate097Web` is a named export, so the `.then` is not optional.
 */
const LazyMigrate097Web = dynamic(() => import("./migrate-097-web").then((m) => m.Migrate097Web), { ssr: false });

export function Migrate097() {
  return <LazyMigrate097Web />;
}
