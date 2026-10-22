"use client";

import { useEffect, useRef, type RefObject } from "react";
import { pagesToEvict } from "./pdf-page-window";

export interface UsePdfPageWindowOpts {
  rootRef: RefObject<HTMLElement | null>;
  pdf: unknown;
  numPages: number;
  renderPage: (n: number) => Promise<void>;
  evictPage: (n: number) => void;
  onVisibleChange: (ratios: ReadonlyMap<number, number>) => void;
}

/** Renders pages one viewport ahead, frees pages beyond the keep radius, reports on-screen ratios. */
export function usePdfPageWindow(opts: UsePdfPageWindowOpts): void {
  const { rootRef, pdf, numPages, renderPage, evictPage, onVisibleChange } = opts;
  const onVisibleChangeRef = useRef(onVisibleChange);
  useEffect(() => {
    onVisibleChangeRef.current = onVisibleChange;
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !pdf || numPages === 0) return;

    const near = new Set<number>();
    // Every page counts as held, so one painted under an earlier observer is freed too.
    const held = new Set<number>(Array.from({ length: numPages }, (_, i) => i + 1));
    const pageOf = (el: Element) => Number((el as HTMLElement).dataset.page);

    const windowObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const n = pageOf(entry.target);
          if (!n) continue;
          if (entry.isIntersecting) {
            near.add(n);
            held.add(n);
            void renderPage(n);
          } else {
            near.delete(n);
          }
        }
        for (const p of pagesToEvict(held, near)) {
          evictPage(p);
          held.delete(p);
        }
      },
      { root, rootMargin: "100% 0px", threshold: 0 },
    );

    // Unmargined, so the current page is the one actually on screen.
    const ratios = new Map<number, number>();
    const visibleObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const n = pageOf(entry.target);
          if (n) ratios.set(n, entry.intersectionRatio);
        }
        onVisibleChangeRef.current(ratios);
      },
      { root, threshold: [0, 0.25, 0.35, 0.5, 0.75, 1] },
    );

    root.querySelectorAll("[data-page]").forEach((el) => {
      windowObserver.observe(el);
      visibleObserver.observe(el);
    });
    return () => {
      windowObserver.disconnect();
      visibleObserver.disconnect();
    };
  }, [rootRef, pdf, numPages, renderPage, evictPage]);
}
