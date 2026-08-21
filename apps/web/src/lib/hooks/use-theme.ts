"use client";

import { useCallback, useEffect, useState } from "react";
import {
  readStoredThemeIds,
  type ThemeMode,
} from "@/lib/theme/theme";
import { persistThemeChange } from "@/lib/theme/theme-persistence";

// Defined in a leaf module so listeners need not pull the persistence
// layer (and the app container behind it) along with them. Re-exported
// because callers have always reached for it through this module.
import { THEME_CHANGE_EVENT } from "@/lib/theme/theme-events";

export { THEME_CHANGE_EVENT };

function readDarkFromDom(): boolean {
  return document.documentElement.dataset.mode === "dark";
}

/** Shared light/dark toggle state for all ThemeToggle mounts. */
export function useTheme() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const sync = () => setDark(readDarkFromDom());
    sync();
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = useCallback(() => {
    const isDark = readDarkFromDom();
    const nextMode: ThemeMode = isDark ? "light" : "dark";
    const { light, dark: darkTheme } = readStoredThemeIds();
    persistThemeChange({
      mode: nextMode,
      lightTheme: light,
      darkTheme: darkTheme,
    });
    setDark(!isDark);
  }, []);

  return { dark, toggle };
}
