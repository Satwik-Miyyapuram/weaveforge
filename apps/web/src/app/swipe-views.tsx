"use client";

import { useMemo, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { buildModuleRegistry, groupForPath } from "@/registry";
import { getContainer } from "@/bootstrap";
import { useNavPending } from "@/lib/nav-pending";

/**
 * Horizontal swipe to move between the sub-tabs of the current group
 * (Library → Papers/Lists/Graph, Experiments → Experiments/Git). Swipes that
 * start on the graph canvas or a form control are ignored so they keep their
 * own gestures. Vertical scrolling is untouched (we never preventDefault).
 */
const IGNORE = ".graph-wrap, .graph-canvas, .dashboard-grid-wrap, .table-scroll, .papers-table-scroll, input, textarea, select, .custom-select-menu, .sub-nav";

export function SwipeViews({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { beginNavigation } = useNavPending();
  const start = useRef<{ x: number; y: number; t: number } | null>(null);

  const navGroups = useMemo(
    () => buildModuleRegistry(getContainer().integrationConfig).navGroups,
    [],
  );
  const group = groupForPath(pathname, navGroups);
  const items = group?.items ?? [];
  const idx = items.findIndex((it) => pathname?.startsWith(it.path));

  function onTouchStart(e: React.TouchEvent) {
    if (items.length < 2) return;
    if (e.touches.length !== 1) {
      start.current = null;
      return;
    }
    if ((e.target as HTMLElement).closest(IGNORE)) {
      start.current = null;
      return;
    }
    const t = e.touches[0];
    if (t) start.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }

  function onTouchEnd(e: React.TouchEvent) {
    const s = start.current;
    start.current = null;
    if (!s || items.length < 2) return;
    if (e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Date.now() - s.t > 600) return;            // too slow
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return; // not a clear horizontal swipe
    const next = items[idx + (dx < 0 ? 1 : -1)];   // swipe left → next tab
    if (next) {
      beginNavigation(next.path);
      router.push(next.path);
    }
  }

  return (
    <div className="swipe-views" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {children}
    </div>
  );
}
