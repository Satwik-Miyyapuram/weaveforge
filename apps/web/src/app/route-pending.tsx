"use client";

import { RouteSkeleton } from "./route-skeleton";
import { useNavPending } from "@/lib/nav-pending";

/** Lightweight skeleton on nav when no cached screen data (Phase 3). */
export function RoutePending({ children }: { children: React.ReactNode }) {
  const { overlay: showSkeleton } = useNavPending();

  return (
    <>
      {showSkeleton ? <RouteSkeleton /> : null}
      <div
        className={
          showSkeleton
            ? "route-pending-content route-pending-content--hidden"
            : "route-pending-content"
        }
      >
        {children}
      </div>
    </>
  );
}
