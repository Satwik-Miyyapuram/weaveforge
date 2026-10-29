"use client";

import { useNavPending } from "@/lib/nav-pending";
import { useLayoutEffect, useRef } from "react";
import { activeNavItem, groupForPath, phoneItems } from "@/registry";
import { useNavGroups } from "@/lib/hooks/use-nav-groups";
import { prefetchScreenForPath } from "@/lib/cache/prefetch-screen";
import { NavLink } from "@/components/controls";

/**
 * Segmented sub-navigation for grouped sections (Library → Papers/Notes/Graph,
 * Experiments → Experiments/Git), one nav item per view. Renders only when the
 * current group has more than one view.
 *
 * Mobile only — the shell gates it (`app-shell.tsx`). On a desktop the sidebar
 * carries every destination, and this strip was the thing that made a section
 * of the sidebar look like six tabs of its own.
 */
export function SubNav() {
  const { effectivePath: pathname } = useNavPending();
  const navRef = useRef<HTMLElement>(null);
  const navGroups = useNavGroups();
  const group = groupForPath(pathname, navGroups);
  // A view that declared itself out of the mobile bar is out of the strip too:
  // they are the same set of destinations seen two ways. See `NavItem.mobile`.
  const items = phoneItems(group?.items ?? []);
  const multi = items.length > 1;
  const activeItem = activeNavItem(items, pathname);

  // On a phone the strip scrolls sideways; a later tab would otherwise be
  // current but out of sight, which reads as "not here".
  useLayoutEffect(() => {
    const nav = navRef.current;
    const el = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!multi || !nav || !el) return;
    if (el.offsetLeft < nav.scrollLeft || el.offsetLeft + el.offsetWidth > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2;
    }
  }, [pathname, multi, group?.key]);

  if (!group || !multi) return null;
  return (
    <nav className="sub-nav" aria-label={`${group.label} views`} ref={navRef}>
      {items.map((it) => {
        const active = activeItem?.key === it.key;
        return (
          <NavLink
            key={it.key}
            href={it.path}
            current={active}
            onPointerEnter={() => prefetchScreenForPath(it.path)}
          >
            {it.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
