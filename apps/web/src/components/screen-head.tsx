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
 * Most screens leave the title out, since the tab bar already says where you
 * are. The page still gets its one `<h1>`, named after the route, so a screen
 * reader's heading list and "jump to main heading" land somewhere. The classic
 * themes keep it hidden; the brutal themes draw it big, with the optional
 * `eyebrow` count above it, because their pages open on a title.
 */
export function ScreenHead({
  title,
  eyebrow,
  note,
  children,
}: {
  title?: string;
  /** A short mono count over the title, e.g. "5 lists · 38 items". */
  eyebrow?: ReactNode;
  /** Status line under the actions, e.g. the result of a sync. */
  note?: ReactNode;
  children?: ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const registry = useModuleRegistry();
  const hidden = title
    ? null
    : labelForPath(pathname, [registry.homeNavItem, ...registry.allModules.flatMap((m) => m.navItems)]);
  return (
    <header className="screen-head">
      <div className="head-row">
        {title || hidden ? (
          <div className="screen-title-block">
            {eyebrow ? <p className="screen-eyebrow">{eyebrow}</p> : null}
            <h1 className={title ? "screen-title" : "screen-title screen-title--auto"}>{title ?? hidden}</h1>
          </div>
        ) : null}
        <div className="screen-actions">{children}</div>
      </div>
      {note}
    </header>
  );
}
