"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { useProject } from "@/features/projects";
import { hasScreenCacheForPath } from "./screen-for-path";
import { perfNow, recordPerf, recordPerfSince } from "./perf";

const PENDING_TIMEOUT_MS = 12_000;

function pathFromHref(href: string): string {
  return href.split(/[?#]/)[0] ?? href;
}

function isInternalNavLink(anchor: HTMLAnchorElement, pathname: string | null): string | null {
  if (anchor.target === "_blank") return null;
  const href = anchor.getAttribute("href");
  if (!href || !href.startsWith("/") || href.startsWith("//")) return null;
  const path = pathFromHref(href);
  return path !== pathname ? path : null;
}

interface NavPendingState {
  /** Pathname used for tab/sub-nav highlighting (target while navigating). */
  effectivePath: string | null;
  /** Show the route-level loader overlay (skipped when destination cache is fresh). */
  overlay: boolean;
  /** Call before `router.push` so tabs + overlay stay in sync with programmatic nav. */
  beginNavigation: (path: string) => void;
}

const NavPendingContext = createContext<NavPendingState | null>(null);

export function NavPendingProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { current } = useProject();
  const projectId = current?.id ?? null;
  const [targetPath, setTargetPath] = useState<string | null>(null);
  const [overlay, setOverlay] = useState(false);
  const pathnameRef = useRef(pathname);
  const pendingSinceRef = useRef<number | null>(null);

  const beginNavigation = useCallback(
    (path: string) => {
      const dest = pathFromHref(path);
      if (dest === pathnameRef.current) return;
      pendingSinceRef.current = perfNow();
      setTargetPath(dest);
      const cacheHit = hasScreenCacheForPath(dest, projectId);
      recordPerf("nav.cache_hit", cacheHit ? 1 : 0);
      recordPerf("nav.overlay_skipped", cacheHit ? 1 : 0);
      setOverlay(!cacheHit);
    },
    [projectId],
  );

  useEffect(() => {
    pathnameRef.current = pathname;
    if (pendingSinceRef.current != null) {
      recordPerfSince("nav.route_ms", pendingSinceRef.current);
    }
    setTargetPath(null);
    setOverlay(false);
    pendingSinceRef.current = null;
  }, [pathname]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const anchor = (event.target as HTMLElement).closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const dest = isInternalNavLink(anchor, pathnameRef.current);
      if (!dest) return;
      beginNavigation(dest);
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [beginNavigation]);

  useEffect(() => {
    if (!overlay) return;
    const id = window.setInterval(() => {
      const since = pendingSinceRef.current;
      if (since == null) return;
      if (perfNow() - since < PENDING_TIMEOUT_MS) return;
      pendingSinceRef.current = null;
      setTargetPath(null);
      setOverlay(false);
    }, 500);
    return () => window.clearInterval(id);
  }, [overlay]);

  const value = useMemo<NavPendingState>(
    () => ({
      effectivePath: targetPath ?? pathname,
      overlay,
      beginNavigation,
    }),
    [targetPath, pathname, overlay, beginNavigation],
  );

  return <NavPendingContext.Provider value={value}>{children}</NavPendingContext.Provider>;
}

export function useNavPending(): NavPendingState {
  const ctx = useContext(NavPendingContext);
  if (!ctx) {
    throw new Error("useNavPending must be used within NavPendingProvider");
  }
  return ctx;
}
