"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { canTransition, isPlainClick, navTransition } from "@/lib/view-transition";

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
  const router = useRouter();

  // Top nav and sub-tab links cross-fade. Capture runs before Link's own click,
  // which then sees defaultPrevented and leaves the push to the transition.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.<HTMLAnchorElement>("a.nav-link, a.sub-tab");
      if (!link || !isPlainClick(e) || !canTransition()) return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      e.preventDefault();
      navTransition("tab", () => router.push(url.pathname + url.search));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

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
