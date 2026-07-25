"use client";

import type { UserAppearance } from "@thesis/core";
import { getContainer } from "@/bootstrap";
import {
  applyControlSize,
  applyTheme,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  readStoredControlSize,
  readStoredMode,
  readStoredThemeIds,
  sanitizeControlSize,
  sanitizeThemeId,
  type ControlSizeId,
  type ThemeMode,
} from "@/lib/theme";
import { THEME_CHANGE_EVENT } from "@/lib/use-theme";
import { singleFlight } from "@/lib/single-flight";

let hydrating = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingAppearance: UserAppearance | null = null;

export function readLocalAppearance(): UserAppearance {
  const { light, dark } = readStoredThemeIds();
  return {
    mode: readStoredMode(),
    lightTheme: light,
    darkTheme: dark,
    controlSize: readStoredControlSize(),
  };
}

export function writeLocalAppearance(appearance: UserAppearance): void {
  try {
    if (appearance.mode === "light" || appearance.mode === "dark") {
      localStorage.setItem("thesis.mode", appearance.mode);
    }
    if (appearance.lightTheme) {
      localStorage.setItem(
        "thesis.theme.light",
        sanitizeThemeId(appearance.lightTheme, "light"),
      );
    }
    if (appearance.darkTheme) {
      localStorage.setItem(
        "thesis.theme.dark",
        sanitizeThemeId(appearance.darkTheme, "dark"),
      );
    }
    if (appearance.controlSize) {
      localStorage.setItem(
        "thesis.controlSize",
        sanitizeControlSize(appearance.controlSize),
      );
    }
  } catch {
    /* ignore */
  }
}

export function applyThemeFromLocalStorage(): void {
  const mode = readStoredMode();
  const { light, dark } = readStoredThemeIds();
  applyTheme(mode, mode === "dark" ? dark : light);
  applyControlSize(readStoredControlSize());
}

function scheduleAppearanceSave(appearance: UserAppearance): void {
  if (hydrating) return;
  pendingAppearance = appearance;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const toSave = pendingAppearance;
    pendingAppearance = null;
    if (!toSave) return;
    void getContainer()
      .settings.manageSettings.saveAppearance(toSave)
      .catch(() => {
        /* best-effort sync */
      });
  }, 600);
}

/** Update local theme immediately and debounce-save to the user settings row. */
export function persistThemeChange(
  patch: Partial<UserAppearance>,
  options?: { apply?: boolean },
): void {
  const current = readLocalAppearance();
  const next: UserAppearance = {
    mode: patch.mode ?? current.mode,
    lightTheme: patch.lightTheme ?? current.lightTheme,
    darkTheme: patch.darkTheme ?? current.darkTheme,
    controlSize: sanitizeControlSize(patch.controlSize ?? current.controlSize) as ControlSizeId,
  };
  writeLocalAppearance(next);
  if (options?.apply !== false) {
    const mode = (next.mode ?? readStoredMode()) as ThemeMode;
    const themeId =
      mode === "dark"
        ? next.darkTheme ?? DEFAULT_DARK_THEME
        : next.lightTheme ?? DEFAULT_LIGHT_THEME;
    applyTheme(mode, themeId);
    applyControlSize(next.controlSize ?? "default");
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  } else if (patch.controlSize) {
    applyControlSize(next.controlSize ?? "default");
  }
  scheduleAppearanceSave(next);
}

/** Load saved appearance from Supabase and apply (server wins on sign-in). */
export function hydrateThemeFromServer(): Promise<void> {
  return singleFlight("theme:hydrate", hydrateThemeFromServerUncached);
}

async function hydrateThemeFromServerUncached(): Promise<void> {
  hydrating = true;
  try {
    const { ensureContainer } = await import("@/bootstrap");
    const container = await ensureContainer();
    const { appearance } = await container.settings.manageSettings.getMetadata();
    if (appearance?.mode || appearance?.lightTheme || appearance?.darkTheme || appearance?.controlSize) {
      writeLocalAppearance({
        mode: appearance.mode ?? readStoredMode(),
        lightTheme: appearance.lightTheme ?? readStoredThemeIds().light,
        darkTheme: appearance.darkTheme ?? readStoredThemeIds().dark,
        controlSize: appearance.controlSize ?? readStoredControlSize(),
      });
      applyThemeFromLocalStorage();
      window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
      return;
    }

    const local = readLocalAppearance();
    await container.settings.manageSettings.saveAppearance(local);
  } finally {
    hydrating = false;
  }
}
