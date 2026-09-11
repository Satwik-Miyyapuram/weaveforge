"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyTheme,
  DARK_THEME_OPTIONS,
  LIGHT_THEME_OPTIONS,
  readStoredMode,
  readStoredThemeIds,
  type ThemeMode,
} from "@/lib/theme/theme";
import { THEME_CHANGE_EVENT } from "@/lib/theme/theme-events";
import { useDismissOnOutside } from "@/lib/hooks/use-dismiss-on-outside";
import css from "./pitch.module.css";
import paletteCss from "./pitch-palette.module.css";

/** The three keys the pitch preview borrows, captured verbatim before it writes. */
const BORROWED_KEYS = ["thesis.mode", "thesis.theme.light", "thesis.theme.dark"] as const;

function snapshotBorrowedKeys(): Record<string, string | null> {
  const snapshot: Record<string, string | null> = {};
  for (const key of BORROWED_KEYS) {
    try {
      snapshot[key] = localStorage.getItem(key);
    } catch {
      snapshot[key] = null;
    }
  }
  return snapshot;
}

function restoreBorrowedKeys(snapshot: Record<string, string | null>): void {
  for (const key of BORROWED_KEYS) {
    try {
      const value = snapshot[key];
      // `null` means the key was not there before, so removing it is the
      // faithful restore — writing a default would invent a preference.
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* storage disabled; nothing was written in the first place */
    }
  }
  const mode = readStoredMode();
  const ids = readStoredThemeIds();
  applyTheme(mode, mode === "dark" ? ids.dark : ids.light);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function ThemePalette() {
  const [mode, setMode] = useState<ThemeMode>("dark");
  const [ids, setIds] = useState<{ light: string; dark: string }>({ light: "light", dark: "amoled" });
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const borrowed = useRef<Record<string, string | null> | null>(null);

  /*
   * Read what the boot script already put on <html> rather than assuming a
   * default, so the control opens on the theme actually being displayed — and
   * snapshot the stored values before this page can touch them.
   *
   * The palette used to write `thesis.mode` and `thesis.theme.<mode>` straight
   * into storage and leave them there. On the public pitch page that is a
   * signed-in reader's real preference: it survives the visit, and the next
   * appearance change inside the app reads it back and syncs it to their
   * account, so trying a palette here silently replaced the theme they chose.
   * The preview is therefore scoped to the visit and put back on unmount, which
   * is exactly the contract `MotionPreview` below already keeps for the motion
   * flag it borrows — the two controls now behave the same way.
   */
  useEffect(() => {
    borrowed.current = snapshotBorrowedKeys();
    setMode(readStoredMode());
    setIds(readStoredThemeIds());
    return () => {
      if (borrowed.current) restoreBorrowedKeys(borrowed.current);
    };
  }, []);

  useDismissOnOutside(open, () => setOpen(false), boxRef);

  const choose = useCallback((nextMode: ThemeMode, id: string) => {
    setMode(nextMode);
    setIds((prev) => ({ ...prev, [nextMode]: id }));
    applyTheme(nextMode, id);
    try {
      // Written so the choice survives a *client-side* route change off this
      // page before the restore runs; the unmount cleanup removes it again.
      localStorage.setItem("thesis.mode", nextMode);
      localStorage.setItem(`thesis.theme.${nextMode}`, id);
    } catch {
      // Private mode, or storage disabled. The theme still applies for this
      // visit; only remembering it across visits is lost.
    }
    // Tells the reactive-motion layer to re-check whether it should be running.
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  const current = mode === "dark" ? ids.dark : ids.light;
  const options = mode === "dark" ? DARK_THEME_OPTIONS : LIGHT_THEME_OPTIONS;
  const label = options.find((o) => o.id === current)?.label ?? "Theme";

  return (
    <div className={paletteCss.palette} ref={boxRef}>
      <button
        type="button"
        className={paletteCss.paletteBtn}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={paletteCss.swatch} aria-hidden />
        <span className={paletteCss.paletteLabel}>{label}</span>
      </button>

      {open && (
        <div className={paletteCss.paletteMenu} role="menu">
          <div className={paletteCss.paletteModes}>
            {(["light", "dark"] as ThemeMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={paletteCss.modeBtn}
                aria-pressed={mode === m}
                onClick={() => choose(m, m === "dark" ? ids.dark : ids.light)}
              >
                {m === "dark" ? "Dark" : "Light"}
              </button>
            ))}
          </div>
          <div className={paletteCss.paletteList}>
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={o.id === current}
                className={paletteCss.paletteItem}
                onClick={() => choose(mode, o.id)}
              >
                {/* The real attribute: the theme files key off `[data-theme=…]`
                    with a bare selector, so this span is painted in that
                    palette and the swatch shows its actual accent. */}
                <span className={paletteCss.swatch} data-theme={o.id} aria-hidden />
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Turns the product's reactive motion layer on for the length of this page,
 * and publishes the pointer position for the page-wide glow.
 *
 * The layer is opt-in inside the app, but the pitch is where it is being sold,
 * so it runs here regardless of the visitor's stored preference — and the
 * previous value is put back on unmount, so visiting /pitch inside the app
 * cannot quietly flip a setting the user turned off.
 */
