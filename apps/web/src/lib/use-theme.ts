"use client";

import { useCallback, useEffect, useState } from "react";
import {
  readStoredThemeIds,
  type ThemeMode,
} from "@/lib/theme";
import { persistThemeChange } from "@/lib/theme-persistence";

export const THEME_CHANGE_EVENT = "thesis-theme-change";

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
