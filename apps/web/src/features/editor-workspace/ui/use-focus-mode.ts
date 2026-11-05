"use client";

import { useCallback, useEffect, useState } from "react";

import { desktop } from "@/lib/desktop/desktop-bridge";

/**
 * Focus: the document and nothing else. Per session, not per device — a
 * window that reopens with every control hidden looks broken, not focused.
 */
export function useFocusMode(): { focus: boolean; toggleFocus: () => void } {
  const [focus, setFocus] = useState(false);
  const toggleFocus = useCallback(() => setFocus((current) => !current), []);
  // The primary nav rail lives outside this screen (app-shell), so the flag is
  // also put on the root element for nav.css to read.
  useEffect(() => {
    const root = document.documentElement;
    if (focus) root.dataset.workspaceFocus = "";
    else delete root.dataset.workspaceFocus;
    // The desktop shell's own chrome — menu bar, title bar — goes with it.
    desktop()?.setWindowFocus?.(focus);
    return () => {
      delete root.dataset.workspaceFocus;
      desktop()?.setWindowFocus?.(false);
    };
  }, [focus]);
  return { focus, toggleFocus };
}
