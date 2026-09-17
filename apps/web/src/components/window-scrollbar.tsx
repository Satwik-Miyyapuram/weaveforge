"use client";

import { useEffect, useRef, useState } from "react";

import { OverlayScrollbar } from "./overlay-scrollbar";

/**
 * The page's own scrollbar, as an overlay.
 *
 * The native one on `<html>` is hidden (base.css) so it never reserves a
 * gutter or shifts the layout when a tab's content grows past the fold; this
 * floats a thumb over the viewport's right edge instead, and only while
 * scrolling. Mounted once, in the root layout.
 */
export function WindowScrollbar() {
  const ref = useRef<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    ref.current = document.documentElement;
    setReady(true);
  }, []);
  if (!ready) return null;
  return <OverlayScrollbar scrollRef={ref} className="overlay-scrollbar-window" />;
}
