"use client";

import Link from "next/link";
import { useNavPending } from "@/lib/nav-pending";
import { useCallback } from "react";
import { useModuleRegistry } from "@/lib/hooks/use-nav-groups";
import { prefetchScreenForPath } from "@/lib/cache/prefetch-screen";
import type { LayoutBreakpoint, NavEnterAnim } from "@/lib/hooks/use-layout-breakpoint";
import { NavIcon } from "./nav-icon";
import { openSearchPalette } from "@/components/jump-to-palette";
import { WeaveForgeLogo } from "@/components/weave-forge-logo";
import { ProjectSwitcher } from "@/features/projects";
import { OrgSwitcher } from "@/features/org";
import { HeaderActions } from "./header-actions";
import { ThemeToggle } from "./theme-toggle";

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
        // Two landmarks render on most screens — this one and the sub-tab strip
        // — and only the strip was named, so a screen-reader user navigating by
        // landmark heard "navigation, navigation" with no way to tell them
        // apart. The toggle also has to say what it does and in which
        // direction: it collapses the labels away into an icon bar, so
        // `aria-expanded` reports that state and `aria-controls` names the list
        // it acts on.
        <button
          className="menu-toggle"
          onClick={onToggle}
          aria-label="Toggle menu"
          aria-expanded={!collapsed}
          aria-controls="nav-links"
          title="Toggle menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
      )}
      <div className="nav-links" id="nav-links">
        <Link
          href={homeNavItem.path}
          className={`nav-link nav-home${homeActive ? " active" : ""}`}
          aria-current={homeActive ? "page" : undefined}
          onPointerEnter={() => warmPath(homeNavItem.path)}
        >
          <NavIcon name={homeNavItem.icon} />
          <span className="nav-label">{homeNavItem.label}</span>
        </Link>
        {/* Search had no visible entry point at all — Ctrl/Cmd+K only, which is
            undiscoverable and unreachable on a phone. It sits in the nav rather
            than in a header because the nav is the one surface present on every
            screen and at every breakpoint. */}
        <button type="button" className="nav-link nav-search" onClick={openSearchPalette}>
          <NavIcon name="search" />
          <span className="nav-label">Search</span>
        </button>
        {navGroups.map((group) => {
          const active = group.items.some((it) => pathname?.startsWith(it.path));
          return (
            <Link
              key={group.key}
              href={group.items[0]?.path ?? "/"}
              className={active ? "nav-link active" : "nav-link"}
              aria-current={active ? "page" : undefined}
              onPointerEnter={() => warmPath(group.items[0]?.path ?? "/")}
            >
              <NavIcon name={group.icon} />
              <span className="nav-label">{group.label}</span>
            </Link>
          );
        })}
      </div>
      {breakpoint === "desktop" && (
        <div className="desktop-only nav-bottom">
          {collapsed ? (
            // The 64px rail cannot hold a labelled project switcher or a stack
            // of account links, so it carries the compact overflow menu the
            // mobile bar uses — the same links, behind the same "⋯" — plus the
            // theme toggle. Everything else the sidebar holds is one click away
            // in the rail's own links above.
            <div className="nav-rail-actions">
              <ThemeToggle />
              <HeaderActions variant="menu" />
            </div>
          ) : (
            <>
              <div className="app-brand">
                <WeaveForgeLogo className="app-logo" />
                <span className="app-name">WeaveForge</span>
              </div>
              <OrgSwitcher />
              <ProjectSwitcher />
              <ThemeToggle />
              <HeaderActions />
            </>
          )}
        </div>
      )}
    </nav>
  );
}
