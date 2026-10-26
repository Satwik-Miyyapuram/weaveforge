"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useModuleRegistry } from "@/lib/hooks/use-nav-groups";
import { labelForPath } from "@/lib/route-title";

/**
 * The header every list screen opens with: an optional title, a row of
 * actions, and whatever status line the screen wants under them.
 *
 * Nine screens hand-wrote the same three nested divs, so the markup drifted
 * (some kept the title inside the row, some outside) even though the CSS
 * expects one shape.
 *
 * It is the one page header (D11): every list screen opens on one visible
 * `<h1>`. A screen that names no title gets the route's name, so Library reads
 * the same as Wiki or Settings. The brutal themes draw it bigger, with the
 * optional `eyebrow` count above it.
 */
export function ScreenHead({
  title,
  eyebrow,
  note,
  search,
  className,
  children,
}: {
  title?: string;
  /** A short mono count over the title, e.g. "5 lists · 38 items". */
  eyebrow?: ReactNode;
  /** Status line under the actions, e.g. the result of a sync. */
  note?: ReactNode;
  /** The screen's search box, first in the actions. */
  search?: { value: string; onChange: (value: string) => void; label: string };
  /** Extra class on the header, e.g. the graph's focus-mode head. */
  className?: string;
  children?: ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const registry = useModuleRegistry();
  const hidden = title
    ? null
    : labelForPath(pathname, [registry.homeNavItem, ...registry.allModules.flatMap((m) => m.navItems)]);
  return (
    <header className={className ? `screen-head page-header ${className}` : "screen-head page-header"}>
      <div className="head-row">
        {title || hidden ? (
          <div className="screen-title-block">
            {eyebrow ? <p className="screen-eyebrow">{eyebrow}</p> : null}
            <h1 className={title ? "screen-title" : "screen-title screen-title--auto"}>{title ?? hidden}</h1>
          </div>
        ) : null}
        <div className="screen-actions">
          {search && (
            <input
              className="search-input"
              type="search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.label}
              aria-label={search.label}
            />
          )}
          {children}
        </div>
      </div>
      {note}
    </header>
  );
}
