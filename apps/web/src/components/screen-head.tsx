"use client";

import { createContext, useContext, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useModuleRegistry } from "@/lib/hooks/parts";
import { readyCore } from "@/lib/rust-core";

/**
 * The account button, supplied by the shell only where no project is open
 * (Home, and the account screens). Those screens have no sidebar to hold it,
 * so the header's action row takes it, after the screen's own actions. On a
 * project page this stays `null` and the sidebar (desktop) or the phone bar
 * holds the button instead.
 */
export const PageHeaderAccount = createContext<ReactNode>(null);

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
  search?: { value: string; onChange: (value: string) => void; label: string; helpId?: string };
  /** Extra class on the header, e.g. the graph's focus-mode head. */
  className?: string;
  children?: ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const registry = useModuleRegistry();
  const account = useContext(PageHeaderAccount);
  const hidden = title
    ? null
    : (readyCore().labelForPath(pathname, [registry.homeNavItem, ...registry.allModules.flatMap((m) => m.navItems)]) ?? null);
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
              data-help-id={search.helpId}
            />
          )}
          {children}
          {account && <div className="project-picker-bar desktop-only">{account}</div>}
        </div>
      </div>
      {note}
    </header>
  );
}
