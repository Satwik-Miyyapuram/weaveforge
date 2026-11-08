import { useEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { ReaderContainerSize } from "@weaveforge/core";

export interface BoxSize {
  width: number;
  height: number;
}

/**
 * What the reader does when its scroll container changes size.
 *
 * A background editor tab is display:none, so it reads 0 wide; fitting to that
 * shrinks the page to the smallest zoom. Keep the last fit instead, and refit
 * at once when the tab is shown again. Any other resize is usually an
 * animation, so it waits for the size to settle.
 */
export function containerResize(last: BoxSize, next: BoxSize): "ignore" | "now" | "settle" {
  if (next.width === last.width && next.height === last.height) return "ignore";
  if (next.width === 0) return "ignore";
  return last.width === 0 ? "now" : "settle";
}

/** The reader's container size, for the fit. `pdf` is the loaded document. */
export function useContainerSize(
  containerRef: RefObject<HTMLDivElement | null>,
  pdf: unknown,
  pageShare: number,
): ReaderContainerSize | null {
  const [containerSize, setContainerSize] = useState<ReaderContainerSize | null>(null);
  /** The document the container was last measured for at once, not settled. */
  const measuredFor = useRef<unknown>(null);

  useEffect(() => {
    const host = containerRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      // Hidden (a background tab): keep the fit it had.
      if (host.clientWidth === 0) return;
      setContainerSize({
        width: Math.max(1, host.clientWidth * pageShare),
        height: Math.max(1, host.clientHeight),
      });
    };
    // The shell animates its width when the pen rail opens or the nav folds;
    // every frame of that is a resize, and every new width would otherwise
    // throw away the canvases and repaint every page. Wait for the size to
    // settle and re-render once at the final width. The first measure after a
    // load is taken at once so the pages appear without delay; a share change
    // comes with the same animation, so it waits like a resize does.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = { width: host.clientWidth, height: host.clientHeight };
    if (measuredFor.current !== pdf) {
      measuredFor.current = pdf;
      measure();
    } else {
      timer = setTimeout(measure, 160);
    }
    const observer = new ResizeObserver(() => {
      const next = { width: host.clientWidth, height: host.clientHeight };
      const action = containerResize(last, next);
      last = next;
      if (action === "ignore") return;
      if (timer) clearTimeout(timer);
      // Shown again: refit before the next paint, so the page never shows small.
      if (action === "now") flushSync(measure);
      else timer = setTimeout(measure, 160);
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [containerRef, pdf, pageShare]);

  return containerSize;
}
