"use client";

import { usePathname } from "next/navigation";

/**
 * Replays a fade + upward-slide animation on every route change by keying on
 * the pathname (the element remounts, so the CSS animation runs again). Gives
 * tab/sub-tab navigation a consistent "flowy" entrance.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDashboard =
    pathname === "/dashboard" || (pathname?.startsWith("/dashboard/") ?? false);
  return (
    <div className={`page-transition${isDashboard ? " page-transition--dashboard" : ""}`}>
      {children}
    </div>
  );
}
