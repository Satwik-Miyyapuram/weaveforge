"use client";

import { ScreenLoader } from "@/components/weaveforge-loader";

/**
 * Shown while navigating, over the previous route.
 *
 * This was grey shimmer bars guessing at a layout they could not know, so they
 * rarely resembled what actually arrived. The branded loader says the same
 * thing — something is coming — without pretending to know its shape.
 */
export function RouteSkeleton() {
  return (
    <section className="screen route-skeleton">
      <ScreenLoader status="Loading…" />
    </section>
  );
}
