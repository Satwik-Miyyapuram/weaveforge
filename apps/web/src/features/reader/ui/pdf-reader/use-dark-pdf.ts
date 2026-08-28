"use client";

import { useEffect, useState } from "react";
import { shouldUseDarkPdfRendering } from "../../application/reader-pdf-theme";

/**
 * Whether pages should be rendered for a dark background.
 *
 * The theme is on the document element, not in React state, and it can change
 * while the reader is open — from the settings screen, or from the system when
 * the theme follows it — so this watches the attributes rather than reading
 * them once at mount.
 */
export function useDarkPdf(): boolean {
  const [darkPdf, setDarkPdf] = useState(false);

  useEffect(() => {
    const readTheme = () => {
      const root = document.documentElement;
      const theme = root.getAttribute("data-theme");
      const mode = root.getAttribute("data-mode");
      setDarkPdf(mode === "dark" || shouldUseDarkPdfRendering(theme, mode));
    };
    readTheme();
    const observer = new MutationObserver(readTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-mode"],
    });
    return () => observer.disconnect();
  }, []);

  return darkPdf;
}
