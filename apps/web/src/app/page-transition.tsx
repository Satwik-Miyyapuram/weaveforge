"use client";

import { usePathname } from "next/navigation";

/**
 * Replays a fade + upward-slide animation on every route change by keying on
 * the pathname (the element remounts, so the CSS animation runs again). Gives
 * tab/sub-tab navigation a consistent "flowy" entrance.
 *
 * The `key` is load-bearing and was missing: `base.css` describes this as
 * "replayed on every route change (keyed by pathname)", but with no key the
 * element kept its identity across navigations, and a CSS animation only runs
 * when its element is inserted. The entrance played once per full page load.
 *
 * Keying remounts the wrapper, and with it `children`. That is safe here rather
 * than a state loss: this wraps the route's own element inside `AppShell`, which
 * Next already swaps wholesale when the path changes — so the subtree is
 * replaced on exactly the renders the key changes on, and no screen is remounted
 * that was not being remounted already. It stays off the project-scoped
 * providers above it (project, profile, auth), which is what would actually hurt
 * to lose.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDashboard =
    pathname === "/dashboard" || (pathname?.startsWith("/dashboard/") ?? false);
  return (
    <div
      key={pathname}
      className={`page-transition${isDashboard ? " page-transition--dashboard" : ""}`}
    >
      {children}
    </div>
  );
}
