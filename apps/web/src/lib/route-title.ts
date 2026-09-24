import type { NavItem } from "@weaveforge/core";

/** Routes with no nav item of their own, named for the window title. */
const EXTRA_TITLES: readonly { path: string; title: string }[] = [
  { path: "/settings", title: "Settings" },
  { path: "/ai-review", title: "Review AI" },
  { path: "/wiki", title: "Wiki" },
  { path: "/reader", title: "Reader" },
  { path: "/report/overleaf", title: "Overleaf" },
  { path: "/shared", title: "Shared" },
  { path: "/supervision", title: "Supervise" },
];

const APP_NAME = "WeaveForge";

/**
 * The window title for a route: "Papers · WeaveForge".
 *
 * Every screen used to keep the layout's bare "WeaveForge", so the taskbar,
 * the history list and a screen reader's page announcement all said the same
 * thing wherever you were. The longest matching path wins, so
 * `/report/overleaf` is not named after `/report`, and a detail route
 * (`/experiments/abc`) takes its list's name.
 */
export function titleForPath(pathname: string, navItems: readonly NavItem[]): string {
  const label = labelForPath(pathname, navItems);
  return label ? `${label} · ${APP_NAME}` : APP_NAME;
}

/** The screen's own name ("Papers"), or null for a route with none. */
export function labelForPath(pathname: string, navItems: readonly NavItem[]): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const candidates = [
    ...navItems.map((item) => ({ path: item.path, title: item.label })),
    ...EXTRA_TITLES,
  ];
  let best: { path: string; title: string } | null = null;
  for (const candidate of candidates) {
    const matches = path === candidate.path || path.startsWith(`${candidate.path}/`);
    if (matches && (!best || candidate.path.length > best.path.length)) best = candidate;
  }
  return best?.title ?? null;
}
