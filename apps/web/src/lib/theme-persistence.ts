"use client";

import type { UserAppearance } from "@thesis/core";
import { getContainer } from "@/bootstrap";
import {
  applyControlSize,
  applyCustomTheme,
  applyReactiveMotion,
  applySurfaceStyle,
  applyTheme,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  readStoredControlSize,
  readStoredCustomTheme,
  readStoredMode,
  readStoredReactiveMotion,
  readStoredSurfaceStyle,
  readStoredThemeIds,
  sanitizeControlSize,
  sanitizeSurfaceStyle,
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
    surfaces: readStoredSurfaceStyle(),
    reactiveMotion: readStoredReactiveMotion(),
    customTheme: readStoredCustomTheme() ?? undefined,
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
    if (appearance.surfaces) {
      localStorage.setItem("thesis.surfaces", sanitizeSurfaceStyle(appearance.surfaces));
    }
    if (typeof appearance.reactiveMotion === "boolean") {
      localStorage.setItem("thesis.reactiveMotion", appearance.reactiveMotion ? "1" : "0");
    }
    // `customTheme` on the appearance record has already been through
    // normalizeThemeConfig, so what is stored is the validated shape.
    if (appearance.customTheme) {
      localStorage.setItem("thesis.customTheme", JSON.stringify(appearance.customTheme));
    } else if (appearance.customTheme === null) {
      localStorage.removeItem("thesis.customTheme");
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
  applySurfaceStyle(readStoredSurfaceStyle());
  applyReactiveMotion(readStoredReactiveMotion());
  applyCustomTheme(readStoredCustomTheme());
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
    surfaces: sanitizeSurfaceStyle(patch.surfaces ?? current.surfaces),
    reactiveMotion: patch.reactiveMotion ?? current.reactiveMotion ?? false,
    // `undefined` in the patch means "not touched", `null` means "remove it" —
    // so the fallback to `current` only happens for the former.
    customTheme: patch.customTheme === undefined ? current.customTheme : patch.customTheme,
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
    applySurfaceStyle(next.surfaces ?? "borderless");
    applyReactiveMotion(next.reactiveMotion ?? false);
    if (patch.customTheme !== undefined) applyCustomTheme(next.customTheme ?? null);
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
    if (
      appearance?.mode ||
      appearance?.lightTheme ||
      appearance?.darkTheme ||
      appearance?.controlSize ||
      appearance?.surfaces ||
      appearance?.reactiveMotion !== undefined ||
      appearance?.customTheme !== undefined
    ) {
      writeLocalAppearance({
        mode: appearance.mode ?? readStoredMode(),
        lightTheme: appearance.lightTheme ?? readStoredThemeIds().light,
        darkTheme: appearance.darkTheme ?? readStoredThemeIds().dark,
        controlSize: appearance.controlSize ?? readStoredControlSize(),
        surfaces: appearance.surfaces ?? readStoredSurfaceStyle(),
        reactiveMotion: appearance.reactiveMotion ?? readStoredReactiveMotion(),
        customTheme:
          appearance.customTheme === undefined
            ? readStoredCustomTheme()
            : appearance.customTheme,
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
