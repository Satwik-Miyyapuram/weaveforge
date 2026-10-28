"use client";

import { useNavPending } from "@/lib/nav-pending";
import { useEffect, useRef, useState } from "react";
import { useModuleRegistry } from "@/lib/hooks/use-nav-groups";
import { activeNavItem, type NavGroup } from "@/registry";
import { prefetchScreenForPath } from "@/lib/cache/prefetch-screen";
import type { LayoutBreakpoint, NavEnterAnim } from "@/lib/hooks/use-layout-breakpoint";
import { NavIcon } from "./nav-icon";
import { ChevronIcon } from "@/components/chevron-icon";
import { openSearchPalette } from "@/components/jump-to-palette";
import { WeaveForgeLogo } from "@/components/weave-forge-logo";
import { ProjectSwitcher } from "@/features/projects";
import { HeaderActions } from "./header-actions";
import type { InboxLink } from "./inbox-links";
import { useRailTip } from "./rail-tip";
import { loadOpenGroups, saveOpenGroups, toggleGroup, withActive } from "./nav-open-groups";
import { useInbox } from "./use-inbox";
import { LocalModeBadge } from "@/features/auth/ui/local-mode-badge";
import { OverlayScrollbar } from "@/components/overlay-scrollbar";
import { FoldButton, NavButton, NavLink } from "@/components/controls";
import { revealActiveNav } from "./reveal-active-nav";

/**
 * Primary navigation, rendered from the module registry. One markup, two
 * layouts via CSS: a left sidebar on desktop, a compact icon+label bar pinned
 * to the bottom on mobile. Adding a feature module adds its nav item
 * automatically — this component is never edited per feature.
 */
export function TabBar({
  collapsed,
  navEnter,
  onToggle,
  breakpoint = "desktop",
}: {
  collapsed?: boolean;
  navEnter?: NavEnterAnim;
  onToggle?: () => void;
  /**
   * Which layout owns the account controls. They live here on desktop and in
   * the shell's brand row on mobile; rendering both and hiding one with CSS
   * mounted two of every switcher, each with its own open/close state.
   */
  breakpoint?: LayoutBreakpoint;
} = {}) {
  const { effectivePath: pathname } = useNavPending();
  const { homeNavItem, topNavItems, navGroups } = useModuleRegistry();
  const homeActive = pathname === "/dashboard" || pathname?.startsWith("/dashboard/");
  // What the AI and other people sent you, last in the sidebar (D-04). Built
  // here rather than in the registry because it depends on who is signed in.
  const inbox = useInbox().links;
  const sideGroups: (Omit<NavGroup, "items"> & { items: InboxLink[] | NavGroup["items"] })[] =
    breakpoint === "desktop" && inbox.length
      ? [...navGroups, { key: "inbox", label: "Inbox", icon: "sparkle", items: inbox }]
      : navGroups;

  /**
   * Group headings fold, and the group you are in is always open.
   *
   * Twelve destinations under four headings came to 717px of links in a 483px
   * column at a 1426×836 window — 234px of scrolling to reach the last group,
   * with the account block taking another 265px below it. Trimming row heights
   * cannot find 234px without cramping every row, so the column shows where you
   * *are* and folds the sections you are not in.
   *
   * The current group is forced open rather than merely defaulted, so navigating
   * can never hide the view you are looking at behind a fold. The others are only
   * ever closed by the reader, so several can stay open where there is height,
   * and that choice is kept across restarts (DA-88). Storage is read after mount
   * so the first render matches the prerendered page.
   */
  const activeGroupKey =
    sideGroups.find((group) => activeNavItem<{ key: string; path: string }>(group.items, pathname))?.key ?? null;
  const [openGroups, setOpenGroups] = useState<readonly string[]>(() =>
    activeGroupKey ? [activeGroupKey] : [],
  );
  useEffect(() => {
    setOpenGroups((prev) => loadOpenGroups(navStore(), null).reduce((acc, k) => withActive(acc, k), [...prev]));
  }, []);
  useEffect(() => {
    setOpenGroups((prev) => withActive(prev, activeGroupKey));
  }, [activeGroupKey]);

  /*
   * The sidebar is the one pane whose content can outgrow it, and the native
   * reveal scrollbar reserves a gutter the moment it appears — which resizes
   * every row in the column. This draws the thumb over the content instead, so
   * overflowing and not overflowing are the same layout.
   */
  const navScrollRef = useRef<HTMLDivElement | null>(null);
  /* On a short window the current row can sit below the fold; show it. */
  useEffect(() => {
    revealActiveNav(navScrollRef.current);
  }, [pathname, openGroups]);
  const railTip = useRailTip(collapsed);
  const navClass = [
    "nav",
    navEnter === "slide" ? "nav--enter-slide" : "",
    navEnter === "rise" ? "nav--enter-rise" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <nav className={navClass} aria-label="Primary" {...railTip.handlers}>
      {railTip.element}
      {onToggle && (
        // One button: the mark, the name and the chevron fold the sidebar
        // together. Home is the first link below. The chevron points the way it
        // goes: left to fold into the rail, right to open it again.
        <div className="nav-head">
          <NavButton
            onClick={onToggle}
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            aria-expanded={!collapsed}
            aria-controls="nav-links"
          >
            <WeaveForgeLogo className="app-logo" />
            <span className="app-name">WeaveForge</span>
            <ChevronIcon open={false} />
          </NavButton>
        </div>
      )}
      <div className="nav-links-wrap">
        <div className="nav-links" id="nav-links" ref={navScrollRef}>
        <NavLink
          href={homeNavItem.path}
          current={homeActive}
          // The visible label is a `<span>` this file can hide — the icon rail in
          // CSS and, below 461px, the whole bottom bar (see `nav.css`). A name
          // that lives only in that span disappears with it, so each item states
          // its own, and the rail's tip reads it (`rail-tip.tsx`).
          aria-label={homeNavItem.label}
          onPointerEnter={() => prefetchScreenForPath(homeNavItem.path)}
        >
          <NavIcon name={homeNavItem.icon} />
          <span className="nav-label">{homeNavItem.label}</span>
        </NavLink>
        {/* Search had no visible entry point at all — Ctrl/Cmd+K only, which is
            undiscoverable and unreachable on a phone. It sits in the nav rather
            than in a header because the nav is the one surface present on every
            screen and at every breakpoint. */}
        <NavButton aria-label="Search" onClick={openSearchPalette}>
          <NavIcon name="search" />
          <span className="nav-label">Search</span>
        </NavButton>
        {topNavItems
          .filter((item) => breakpoint === "desktop" || item.mobile !== false)
          .map((item) => {
            const active = activeNavItem([item], pathname) !== undefined;
            return (
              <NavLink
                key={item.key}
                href={item.path}
                current={active}
                aria-label={item.label}
                onPointerEnter={() => prefetchScreenForPath(item.path)}
              >
                <NavIcon name={item.icon ?? "box"} />
                <span className="nav-label">{item.label}</span>
              </NavLink>
            );
          })}
        {breakpoint === "desktop"
          ? // The sidebar lists every destination, under its group. The top strip
            // is mobile-only now, so this is the *only* way to reach a view on a
            // desktop: one entry per group would have hidden Papers behind a
            // click on Library, and the strip that made that acceptable is gone
            // at this width.
            sideGroups.map((group) => {
              // In the rail every item shows: the headings are hidden there, so a
              // folded group would be a section with no way to see or open it.
              const open = collapsed === true || openGroups.includes(group.key);
              return (
                <div className="nav-group" key={group.key}>
                  <FoldButton
                    expanded={open}
                    aria-controls={`nav-group-${group.key}`}
                    title={collapsed ? group.label : undefined}
                    onClick={() => {
                      const next = toggleGroup(openGroups, group.key);
                      setOpenGroups(next);
                      saveOpenGroups(navStore(), next);
                    }}
                  >
                    <span>{group.label}</span>
                  </FoldButton>
                  {open && (
                    <div className="nav-group-items" id={`nav-group-${group.key}`}>
                      {group.items.map((item) => {
                        const active = activeNavItem<{ key: string; path: string }>(group.items, pathname)?.key === item.key;
                        return (
                          <NavLink
                            key={item.key}
                            href={item.path}
                            current={active}
                            aria-label={item.label}
                            onPointerEnter={() => prefetchScreenForPath(item.path)}
                          >
                            <NavIcon name={item.icon ?? group.icon} />
                            <span className="nav-label">{item.label}</span>
                            {"badge" in item && item.badge !== undefined && (
                              <b className="nav-badge" aria-label={`${item.badge} waiting`}>{item.badge}</b>
                            )}
                          </NavLink>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          : // One entry per group on the phone: six slots in the bottom bar, and
            // the strip above the content carries the group's own views. Items
            // that declared themselves out of the mobile bar are not counted
            // here, and are not in the strip either. See `NavItem.mobile`.
            navGroups
              .filter((group) => group.items.some((it) => it.mobile !== false))
              .map((group) => {
                const active = group.items.some((it) => pathname?.startsWith(it.path));
                return (
                  <NavLink
                    key={group.key}
                    href={group.items[0]?.path ?? "/"}
                    current={active}
                    aria-label={group.label}
                    title={collapsed ? group.label : undefined}
                    onPointerEnter={() => prefetchScreenForPath(group.items[0]?.path ?? "/")}
                  >
                    <NavIcon name={group.icon} />
                    <span className="nav-label">{group.label}</span>
                  </NavLink>
                );
              })}
        </div>
        <OverlayScrollbar scrollRef={navScrollRef} className="overlay-scrollbar-nav" />
      </div>
      {breakpoint === "desktop" && (
        // The same block whether the sidebar is wide or a rail. Collapsing hides
        // the labels and the switchers in CSS and leaves the icons; it does not
        // swap in a different set of controls, which is what made the rail read
        // as a different app from the sidebar. The brand is not here any more —
        // it is the control at the top.
        <div className="desktop-only nav-bottom">
          {/* Account, project and the account menu on one row. Three things
              that say whose work this is; a row each was height the column
              does not have. In the rail the two switchers hide in CSS and the
              ⋯ keeps its place, which is where it already was. */}
          <div className="nav-account-row">
            <ProjectSwitcher />
            <HeaderActions inbox={false} alone={collapsed} />
          </div>
          <LocalModeBadge />
        </div>
      )}
    </nav>
  );
}

/** localStorage, or nothing where the browser blocks it. */
function navStore(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
