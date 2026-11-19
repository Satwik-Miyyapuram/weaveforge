"use client";

/**
 * The live theme's ink palette and map theme, for surfaces that resolve
 * stroke colours at render time (`resolveInkColour`). Re-read on the app's
 * theme-change event, and the way the ink note's host already does it: when
 * the root's attributes change, when the OS scheme flips, and once late for a
 * stylesheet that lands after the first paint. Strokes re-render without the
 * page being reopened.
 */

import { useEffect, useRef, useState } from "react";
import { readyCore } from "@/lib/rust-core";
import { THEME_CHANGE_EVENT } from "@/lib/theme/theme-events";
import { PAPER_INK_THEME } from "../render/map-ink-colour";
import { readThemePalette } from "../render/parts-1";
import { inkThemeOf, PAPER_INK_PALETTE, type ThemeInk } from "../render/resolve-ink-colour";

const PAPER: ThemeInk = { palette: PAPER_INK_PALETTE, theme: PAPER_INK_THEME };

/** Reads the theme's ink palette and the `--bg` token (the page the ink sits on). */
export function readThemeInk(): ThemeInk {
  const palette = readThemePalette(document);
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.color = "var(--bg)";
  document.body.appendChild(probe);
  try {
    const bg = readyCore().parseCssColour(getComputedStyle(probe).color);
    if (!bg) return PAPER;
    // paletteHex formats a palette entry; borrow it for the background triple.
    return { palette, theme: inkThemeOf(palette, readyCore().paletteHex({ ...palette, text: bg }, "text")) };
  } finally {
    probe.remove();
  }
}

export function useThemeInk(read: () => ThemeInk = readThemeInk): ThemeInk {
  // Paper on the first render, so server and client agree.
  const [ink, setInk] = useState<ThemeInk>(PAPER);
  const reader = useRef(read);
  reader.current = read;
  useEffect(() => {
    // Root attributes change for more than themes; keep the old object when nothing moved.
    const refresh = () => {
      const next = reader.current();
      setInk((last) => (JSON.stringify(last) === JSON.stringify(next) ? last : next));
    };
    refresh();
    window.addEventListener(THEME_CHANGE_EVENT, refresh);
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", refresh);
    const late = window.setTimeout(refresh, 500);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, refresh);
      observer.disconnect();
      media.removeEventListener("change", refresh);
      window.clearTimeout(late);
    };
  }, []);
  return ink;
}
