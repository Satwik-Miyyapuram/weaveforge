"use client";

import Link from "next/link";
import { useNavPending } from "@/lib/nav-pending";
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { groupForPath } from "@/registry";
import { useNavGroups } from "@/lib/hooks/use-nav-groups";
import { prefetchScreenForPath } from "@/lib/cache/prefetch-screen";

/**
 * Segmented sub-navigation for grouped sections (Library → Papers/Notes/Graph,
 * Experiments → Experiments/Git). A pill indicator slides horizontally to the
 * active tab. Renders only when the current group has more than one view.
 *
 * Mobile only — the shell gates it (`app-shell.tsx`). On a desktop the sidebar
 * carries every destination, and this strip was the thing that made a section
 * of the sidebar look like six tabs of its own.
 */
export function SubNav() {
  const { effectivePath: pathname } = useNavPending();
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const navGroups = useNavGroups();
  const group = groupForPath(pathname, navGroups);
  // A view that declared itself out of the mobile bar is out of the strip too:
  // they are the same set of destinations seen two ways. See `NavItem.mobile`.
  const items = group?.items.filter((it) => it.mobile !== false) ?? [];
  const multi = items.length > 1;
  const warmPath = useCallback((href: string) => {
    prefetchScreenForPath(href.split(/[?#]/)[0] ?? href);
  }, []);

  // Position the sliding indicator under the active tab (after layout).
  useLayoutEffect(() => {
    if (!multi) {
      setPill(null);
      return;
    }
    const nav = navRef.current;
    const el = nav?.querySelector<HTMLElement>(".sub-tab.active");
    if (!nav || !el) return;
    setPill({ left: el.offsetLeft, width: el.offsetWidth });
    // On a phone the strip scrolls sideways; a later tab would otherwise be
    // active but out of sight, which reads as "not here".
    if (el.offsetLeft < nav.scrollLeft || el.offsetLeft + el.offsetWidth > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2;
    }
  }, [pathname, multi, group?.key]);

  // Reposition on resize (label widths can change).
  useEffect(() => {
    if (!multi) return;
    const onResize = () => {
      const el = navRef.current?.querySelector<HTMLElement>(".sub-tab.active");
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [multi]);

  if (!group || !multi) return null;
  return (
    <nav className="sub-nav" aria-label={`${group.label} views`} ref={navRef}>
      {pill && (
        <span
          className="sub-tab-indicator"
          style={{ transform: `translateX(${pill.left}px)`, width: pill.width }}
        />
      )}
      {items.map((it) => {
        const matches = items.filter(
          (item) => pathname === item.path || pathname?.startsWith(`${item.path}/`),
        );
        const best = [...matches].sort((a, b) => b.path.length - a.path.length)[0];
        const active = best?.key === it.key;
        return (
          <Link
            key={it.key}
            href={it.path}
            className={active ? "sub-tab active" : "sub-tab"}
            aria-current={active ? "page" : undefined}
            onPointerEnter={() => warmPath(it.path)}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
