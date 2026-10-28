"use client";

import type { UserAppearance } from "@weaveforge/core";
import { ensureContainer, getContainer } from "@/bootstrap";
import { logToApp } from "@/lib/error-report/app-log";
import { describeRejection } from "@/lib/format-error";
import {
  applyAnimationSpeed,
  applyCardTilt,
  applyCardTint,
  applyControlSize,
  applyCustomTheme,
  applyReactiveMotion,
  applyScanlines,
  applySurfaceStyle,
  applyTheme,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  readStoredAnimationSpeed,
  readStoredCardTilt,
  readStoredCardTint,
  readStoredControlSize,
  readStoredCustomTheme,
  readStoredMode,
  readStoredReactiveMotion,
  readStoredScanlines,
  readStoredSurfaceStyle,
  readStoredThemeIds,
  sanitizeAnimationSpeed,
  sanitizeCardTint,
  sanitizeControlSize,
  sanitizeSurfaceStyle,
  sanitizeThemeId,
  THEME_KEY,
  type ControlSizeId,
  type ThemeMode,
} from "@/lib/theme/theme";
import { THEME_CHANGE_EVENT } from "@/lib/theme/theme-events";
import { singleFlight } from "@/lib/cache/single-flight";
import { removeStored, writeStored } from "@/lib/safe-storage";

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
    animationSpeed: readStoredAnimationSpeed(),
    cardTint: readStoredCardTint(),
    cardTilt: readStoredCardTilt(),
    scanlines: readStoredScanlines(),
    customTheme: readStoredCustomTheme() ?? undefined,
  };
}

/**
 * The server's appearance over this device's. A missing or null server field
 * keeps the local one, except `customTheme`: null there means "no custom theme".
 */
export function mergeServerAppearance(local: UserAppearance, server: UserAppearance): UserAppearance {
  const merged: UserAppearance = { ...local };
  for (const [key, value] of Object.entries(server) as [keyof UserAppearance, unknown][]) {
    if (value === undefined || (value === null && key !== "customTheme")) continue;
    (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

function writeLocalAppearance(appearance: UserAppearance): void {
  if (appearance.mode === "light" || appearance.mode === "dark") {
    writeStored(THEME_KEY.mode, appearance.mode);
  }
  if (appearance.lightTheme) {
    writeStored(THEME_KEY.light, sanitizeThemeId(appearance.lightTheme, "light"));
  }
  if (appearance.darkTheme) {
    writeStored(THEME_KEY.dark, sanitizeThemeId(appearance.darkTheme, "dark"));
  }
  if (appearance.controlSize) {
    writeStored(THEME_KEY.controlSize, sanitizeControlSize(appearance.controlSize));
  }
  if (appearance.surfaces) {
    writeStored(THEME_KEY.surfaces, sanitizeSurfaceStyle(appearance.surfaces));
  }
  if (appearance.cardTint) {
    writeStored(THEME_KEY.cardTint, sanitizeCardTint(appearance.cardTint));
  }
  if (typeof appearance.cardTilt === "boolean") {
    writeStored(THEME_KEY.cardTilt, appearance.cardTilt ? "1" : "0");
  }
  if (typeof appearance.scanlines === "boolean") {
    writeStored(THEME_KEY.scanlines, appearance.scanlines ? "1" : "0");
  }
  if (typeof appearance.reactiveMotion === "boolean") {
    writeStored(THEME_KEY.reactiveMotion, appearance.reactiveMotion ? "1" : "0");
  }
  if (appearance.animationSpeed !== undefined) {
    writeStored(THEME_KEY.animationSpeed, String(sanitizeAnimationSpeed(appearance.animationSpeed)));
  }
  // `customTheme` on the appearance record has already been through
  // normalizeThemeConfig, so what is stored is the validated shape.
  if (appearance.customTheme) {
    writeStored(THEME_KEY.customTheme, JSON.stringify(appearance.customTheme));
  } else if (appearance.customTheme === null) {
    removeStored(THEME_KEY.customTheme);
  }
}

function applyThemeFromLocalStorage(): void {
  const mode = readStoredMode();
  const { light, dark } = readStoredThemeIds();
  applyTheme(mode, mode === "dark" ? dark : light);
  applyControlSize(readStoredControlSize());
  applySurfaceStyle(readStoredSurfaceStyle());
  applyReactiveMotion(readStoredReactiveMotion());
  applyAnimationSpeed(readStoredAnimationSpeed());
  applyCardTint(readStoredCardTint());
  applyCardTilt(readStoredCardTilt());
  applyScanlines(readStoredScanlines());
  applyCustomTheme(readStoredCustomTheme());
}

function scheduleAppearanceSave(appearance: UserAppearance): void {
  if (hydrating) return;
  pendingAppearance = appearance;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const toSave = pendingAppearance;
    pendingAppearance = null;
    if (toSave) void saveAppearance(toSave);
  }, 600);
}

/** Best-effort server copy: a failure is logged, never thrown into the timer. */
async function saveAppearance(appearance: UserAppearance): Promise<void> {
  try {
    await getContainer().settings.manageSettings.saveAppearance(appearance);
  } catch (error) {
    logToApp({
      level: "warn",
      source: "appearance",
      message: "Saving the appearance to the server failed",
      detail: describeRejection(error),
    });
  }
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
    animationSpeed: sanitizeAnimationSpeed(patch.animationSpeed ?? current.animationSpeed),
    cardTint: sanitizeCardTint(patch.cardTint ?? current.cardTint),
    cardTilt: patch.cardTilt ?? current.cardTilt ?? true,
    scanlines: patch.scanlines ?? current.scanlines ?? true,
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
    applyAnimationSpeed(sanitizeAnimationSpeed(next.animationSpeed));
    applyCardTint(next.cardTint ?? "bar");
    applyCardTilt(next.cardTilt ?? true);
    applyScanlines(next.scanlines ?? true);
    if (patch.customTheme !== undefined) applyCustomTheme(next.customTheme ?? null);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  } else if (patch.controlSize) {
    applyControlSize(next.controlSize ?? "default");
  }
  scheduleAppearanceSave(next);
}

/** Load saved appearance from the database and apply (server wins on sign-in). */
export function hydrateThemeFromServer(): Promise<void> {
  return singleFlight("theme:hydrate", hydrateThemeFromServerUncached);
}

async function hydrateThemeFromServerUncached(): Promise<void> {
  hydrating = true;
  try {
    const container = await ensureContainer();
    const { appearance } = await container.settings.manageSettings.getMetadata();
    if (
      appearance?.mode ||
      appearance?.lightTheme ||
      appearance?.darkTheme ||
      appearance?.controlSize ||
      appearance?.surfaces ||
      appearance?.reactiveMotion !== undefined ||
      appearance?.animationSpeed !== undefined ||
      appearance?.cardTint ||
      appearance?.cardTilt !== undefined ||
      appearance?.scanlines !== undefined ||
      appearance?.customTheme !== undefined
    ) {
      writeLocalAppearance(mergeServerAppearance(readLocalAppearance(), appearance));
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
