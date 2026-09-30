"use client";

import { useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { groupForPath } from "@/registry";
import { useNavGroups } from "@/lib/hooks/use-nav-groups";
import { useNavPending } from "@/lib/nav-pending";

/**
 * Horizontal swipe to move between the sub-tabs of the current group
 * (Library → Papers/Lists/Graph, Experiments → Experiments/Git). Swipes that
 * start on the graph canvas or a form control are ignored so they keep their
 * own gestures. Vertical scrolling is untouched (we never preventDefault).
 */
const EDGE = 24;
const IGNORE =
  ".graph-wrap, .graph-canvas, .dashboard-grid-wrap, .table-scroll, .papers-table-scroll, input, textarea, select, .custom-select-menu, .sub-nav, .ink-wrap, .ink-page, .ink-canvas, .ink-host, .ink-page-scroll, [data-ink], .workspace-screen, .editor-workspace, .document-host, .editor-pane, canvas, [style*='touch-action: none']";

export function SwipeViews({
  children,
  disabled = false,
}: {
  children: React.ReactNode;
  /** Detail views (single paper/note/experiment) opt out of the gesture. */
  disabled?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { beginNavigation } = useNavPending();
  const start = useRef<{ x: number; y: number; t: number } | null>(null);

  const navGroups = useNavGroups();
  const group = groupForPath(pathname, navGroups);
  const items = group?.items ?? [];
  const idx = items.findIndex((it) => pathname?.startsWith(it.path));

  function onTouchStart(e: React.TouchEvent) {
    if (disabled || items.length < 2) return;
    if (e.touches.length !== 1) {
      start.current = null;
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target?.closest(IGNORE) || target?.tagName === "CANVAS") {
      start.current = null;
      return;
    }
    const t = e.touches[0];
    // The outer 24px belong to the system: back on Android, the edge swipe on
    // iOS. A swipe that starts there is one of those, not one of ours.
    if (!t || t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return;
    start.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }

  function onTouchEnd(e: React.TouchEvent) {
    const s = start.current;
    start.current = null;
    if (disabled || !s || items.length < 2) return;
    if (e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Date.now() - s.t > 600) return; // too slow
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return; // not a clear horizontal swipe
    const next = items[idx + (dx < 0 ? 1 : -1)]; // swipe left → next tab
    if (next) {
      beginNavigation(next.path);
      router.push(next.path);
    }
  }

  return (
    <div
      className="swipe-views"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {children}
    </div>
  );
}
