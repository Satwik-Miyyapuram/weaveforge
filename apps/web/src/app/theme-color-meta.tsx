"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { THEME_CHANGE_EVENT } from "@/lib/theme/theme-events";

/** Sync PWA theme-color meta with the active --bg token. */
export function ThemeColorMeta() {
  // Re-run on route change: navigating can re-apply the layout's static
  // themeColor meta; sync back to the live --bg token for the TWA status bar.
  const pathname = usePathname();

  useEffect(() => {
    const update = () => {
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
      if (!bg) return;
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "theme-color");
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", bg);
    };
    update();
    window.addEventListener(THEME_CHANGE_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, [pathname]);
  return null;
}
