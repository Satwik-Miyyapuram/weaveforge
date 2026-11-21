"use client";

/**
 * Keeps the running app's window and taskbar icon in the active theme's colours.
 * Desktop only: it does nothing in the browser, where the bridge is missing.
 */

import { useEffect } from "react";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { THEME_CHANGE_EVENT } from "@/lib/theme/theme-events";
import { logToApp } from "@/lib/error-report/app-log";
import { describeRejection } from "@/lib/format-error";
import { recolourEmblem, taskbarEmblem } from "./emblem-svg";
import { pickWindowIconColours, themeLogoColours, type OsMode } from "./window-icon-colours";

const EMBLEM_URL = "/icons/weave_forge.svg";
/** Windows scales the icon down; 256 keeps it sharp at every taskbar size. */
const ICON_SIZE = 256;
const PNG_PREFIX = "data:image/png;base64,";

let emblemSource: Promise<string> | null = null;

/** Exported for tests. A failed fetch is forgotten, so the next call retries (P2-142). */
export function loadEmblem(): Promise<string> {
  emblemSource ??= fetch(EMBLEM_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`The emblem did not load (${response.status}).`);
      return response.text();
    })
    .catch((error: unknown) => {
      emblemSource = null;
      throw error;
    });
  return emblemSource;
}

/** Draws the SVG at ICON_SIZE and returns the PNG as base64, without the data URL prefix. */
async function rasterise(svg: string): Promise<string> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image(ICON_SIZE, ICON_SIZE);
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = ICON_SIZE;
    canvas.height = ICON_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2D canvas for the window icon.");
    context.drawImage(image, 0, 0, ICON_SIZE, ICON_SIZE);
    const dataUrl = canvas.toDataURL("image/png");
    if (!dataUrl.startsWith(PNG_PREFIX)) throw new Error("The window icon was not a PNG.");
    return dataUrl.slice(PNG_PREFIX.length);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function logIconFailure(error: unknown): void {
  logToApp({
    level: "warn",
    source: "window-icon",
    message: "The window icon was not updated",
    detail: describeRejection(error),
  });
}

/** Mounts once in the layout: sets the icon on load and again on every theme change. */
export function useDesktopWindowIcon(): void {
  useEffect(() => {
    const bridge = desktop();
    if (!bridge?.setWindowIcon || !bridge.osUsesLightTheme) return;
    const setIcon = bridge.setWindowIcon.bind(bridge);
    let mode: OsMode | null = null;
    let stopped = false;

    const apply = async (): Promise<void> => {
      if (!mode) return;
      const style = getComputedStyle(document.documentElement);
      const colours = pickWindowIconColours(
        themeLogoColours((name) => style.getPropertyValue(name)),
        mode,
      );
      const png = await rasterise(taskbarEmblem(recolourEmblem(await loadEmblem(), colours)));
      if (!stopped) setIcon(png);
    };
    const applyLogged = () => {
      apply().catch(logIconFailure);
    };

    bridge
      .osUsesLightTheme()
      .then((light) => {
        mode = light ? "light" : "dark";
        applyLogged();
      })
      .catch(logIconFailure);
    window.addEventListener(THEME_CHANGE_EVENT, applyLogged);
    return () => {
      stopped = true;
      window.removeEventListener(THEME_CHANGE_EVENT, applyLogged);
    };
  }, []);
}

/** Mounts the window icon sync in the layout. Renders nothing. */
export function DesktopWindowIcon(): null {
  useDesktopWindowIcon();
  return null;
}
