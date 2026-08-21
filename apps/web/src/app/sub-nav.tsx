"use client";

import Link from "next/link";
import { useNavPending } from "@/lib/nav-pending";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { buildModuleRegistry, groupForPath } from "@/registry";
import { getContainer } from "@/bootstrap";
import { prefetchScreenForPath } from "@/lib/cache/prefetch-screen";

/**
 * Segmented sub-navigation for grouped sections (Library → Papers/Lists/Graph,
 * Experiments → Experiments/Git). A pill indicator slides horizontally to the
 * active tab. Renders only when the current group has more than one view.
 */
export function SubNav() {
  const { effectivePath: pathname } = useNavPending();
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const navGroups = useMemo(
    () => buildModuleRegistry(getContainer().integrationConfig).navGroups,
    [],
  );
  const group = groupForPath(pathname, navGroups);
  const multi = !!group && group.items.length > 1;
  const warmPath = useCallback((href: string) => {
    prefetchScreenForPath(href.split(/[?#]/)[0] ?? href);
  }, []);

  // Position the sliding indicator under the active tab (after layout).
  useLayoutEffect(() => {
    if (!multi) {
      setPill(null);
      return;
    }
    const el = navRef.current?.querySelector<HTMLElement>(".sub-tab.active");
    if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
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
      {group.items.map((it) => {
        const matches = group.items.filter(
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
