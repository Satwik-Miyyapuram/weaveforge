"use client";

import { ScreenLoader } from "@/components/weaveforge-loader";

/**
 * Full-screen loader while a list screen has no cached data yet.
 * Branded status only — no layout-guessing skeleton bars.
 */
export function ScreenLoading({
  status,
  className = "screen",
}: {
  status: string;
  className?: string;
}) {
  return (
    <section className={`${className} screen-loading`} aria-busy="true">
      <ScreenLoader status={status} />
    </section>
  );
}
