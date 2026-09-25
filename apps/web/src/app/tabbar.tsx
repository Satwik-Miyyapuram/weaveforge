"use client";

import Link from "next/link";
import { useNavPending } from "@/lib/nav-pending";
import { useCallback, useEffect, useRef, useState } from "react";
import { useModuleRegistry } from "@/lib/hooks/use-nav-groups";
import { prefetchScreenForPath } from "@/lib/cache/prefetch-screen";
import type { LayoutBreakpoint, NavEnterAnim } from "@/lib/hooks/use-layout-breakpoint";
import { NavIcon } from "./nav-icon";
import { ChevronIcon } from "@/components/chevron-icon";
import { openSearchPalette } from "@/components/jump-to-palette";
import { WeaveForgeLogo } from "@/components/weave-forge-logo";
import { ProjectSwitcher } from "@/features/projects";
import { OrgSwitcher } from "@/features/org";
import { HeaderActions } from "./header-actions";
import { LocalModeBadge } from "@/features/auth/ui/local-mode-badge";
import { OverlayScrollbar } from "@/components/overlay-scrollbar";

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
  const { homeNavItem, navGroups } = useModuleRegistry();
  const homeActive = pathname === "/dashboard" || pathname?.startsWith("/dashboard/");

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
   * ever closed by the reader, so several can stay open where there is height.
   */
  const activeGroupKey =
    navGroups.find((group) => group.items.some((it) => pathname?.startsWith(it.path)))?.key ?? null;
  const [openGroups, setOpenGroups] = useState<readonly string[]>(() =>
    activeGroupKey ? [activeGroupKey] : [],
  );
  useEffect(() => {
    if (!activeGroupKey) return;
    setOpenGroups((prev) => (prev.includes(activeGroupKey) ? prev : [...prev, activeGroupKey]));
  }, [activeGroupKey]);

  /*
   * The sidebar is the one pane whose content can outgrow it, and the native
   * reveal scrollbar reserves a gutter the moment it appears — which resizes
   * every row in the column. This draws the thumb over the content instead, so
   * overflowing and not overflowing are the same layout.
   */
  const navScrollRef = useRef<HTMLDivElement | null>(null);

  const warmPath = useCallback((href: string) => {
    prefetchScreenForPath(href.split(/[?#]/)[0] ?? href);
  }, []);
  const navClass = [
    "nav",
    navEnter === "slide" ? "nav--enter-slide" : "",
    navEnter === "rise" ? "nav--enter-rise" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <nav className={navClass} aria-label="Primary">
      {onToggle && (
        // The brand is the collapse control, and it replaced the hamburger. The
        // sidebar already names itself at the top; a second icon doing the same
        // job two rows below was one control too many, and the brand is the
        // thing a reader reaches for to change the nav's size. `aria-expanded`
        // reports the state, and the chevron points the way the toggle goes:
        // right to open the rail, left to fold it back.
        <button
          type="button"
          className="nav-brand-toggle"
          onClick={onToggle}
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          aria-expanded={!collapsed}
          aria-controls="nav-links"
          title={collapsed ? "Expand menu" : "Collapse menu"}
        >
          <WeaveForgeLogo className="app-logo" />
          <span className="app-name">WeaveForge</span>
          <span className="chev"><ChevronIcon open={false} /></span>
        </button>
      )}
      <div className="nav-links-wrap">
        <div className="nav-links" id="nav-links" ref={navScrollRef}>
        <Link
          href={homeNavItem.path}
          className={`nav-link nav-home${homeActive ? " active" : ""}`}
          aria-current={homeActive ? "page" : undefined}
          // The visible label is a `<span>` this file can hide — the icon rail in
          // CSS and, below 461px, the whole bottom bar (see `nav.css`). A name
          // that lives only in that span disappears with it, so each item states
          // its own. `title` stays for the hover tooltip the rail has always had.
          aria-label={homeNavItem.label}
          title={collapsed ? homeNavItem.label : undefined}
          onPointerEnter={() => warmPath(homeNavItem.path)}
        >
          <NavIcon name={homeNavItem.icon} />
          <span className="nav-label">{homeNavItem.label}</span>
        </Link>
        {/* Search had no visible entry point at all — Ctrl/Cmd+K only, which is
            undiscoverable and unreachable on a phone. It sits in the nav rather
            than in a header because the nav is the one surface present on every
            screen and at every breakpoint. */}
        <button
          type="button"
          className="nav-link nav-search"
          aria-label="Search"
          title={collapsed ? "Search" : undefined}
          onClick={openSearchPalette}
        >
          <NavIcon name="search" />
          <span className="nav-label">Search</span>
        </button>
        {breakpoint === "desktop"
          ? // The sidebar lists every destination, under its group. The top strip
            // is mobile-only now, so this is the *only* way to reach a view on a
            // desktop: one entry per group would have hidden Papers behind a
            // click on Library, and the strip that made that acceptable is gone
            // at this width.
            navGroups.map((group) => {
              // In the rail every item shows: the headings are hidden there, so a
              // folded group would be a section with no way to see or open it.
              const open = collapsed === true || openGroups.includes(group.key);
              return (
                <div className="nav-group" key={group.key}>
                  <button
                    type="button"
                    className="nav-group-label"
                    aria-expanded={open}
                    aria-controls={`nav-group-${group.key}`}
                    title={collapsed ? group.label : undefined}
                    onClick={() =>
                      setOpenGroups((prev) =>
                        prev.includes(group.key)
                          ? prev.filter((k) => k !== group.key)
                          : [...prev, group.key],
                      )
                    }
                  >
                    <span>{group.label}</span>
                    <ChevronIcon open={open} />
                  </button>
                  {open && (
                    <div className="nav-group-items" id={`nav-group-${group.key}`}>
                      {group.items.map((item) => {
                        const active = Boolean(pathname?.startsWith(item.path));
                        return (
                          <Link
                            key={item.key}
                            href={item.path}
                            className={active ? "nav-link active" : "nav-link"}
                            aria-current={active ? "page" : undefined}
                            aria-label={item.label}
                            title={collapsed ? item.label : undefined}
                            onPointerEnter={() => warmPath(item.path)}
                          >
                            <NavIcon name={item.icon ?? group.icon} />
                            <span className="nav-label">{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          : // One entry per group on the phone: six slots in the bottom bar, and
            // the strip above the content carries the group's own views. Items
            // that declared themselves out of the mobile bar — the editor — are
            // not counted here, and are not in the strip either. See
            // `NavItem.mobile`.
            navGroups
              .filter((group) => group.items.some((it) => it.mobile !== false))
              .map((group) => {
                const active = group.items.some((it) => pathname?.startsWith(it.path));
                return (
                  <Link
                    key={group.key}
                    href={group.items[0]?.path ?? "/"}
                    className={active ? "nav-link active" : "nav-link"}
                    aria-current={active ? "page" : undefined}
                    aria-label={group.label}
                    title={collapsed ? group.label : undefined}
                    onPointerEnter={() => warmPath(group.items[0]?.path ?? "/")}
                  >
                    <NavIcon name={group.icon} />
                    <span className="nav-label">{group.label}</span>
                  </Link>
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
            <OrgSwitcher />
            <ProjectSwitcher />
            <HeaderActions variant="menu" />
          </div>
          <LocalModeBadge />
        </div>
      )}
    </nav>
  );
}
