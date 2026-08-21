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

export function ThemePalette() {
  const [mode, setMode] = useState<ThemeMode>("dark");
  const [ids, setIds] = useState<{ light: string; dark: string }>({ light: "light", dark: "amoled" });
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Read what the boot script already put on <html> rather than assuming a
  // default, so the control opens on the theme actually being displayed.
  useEffect(() => {
    setMode(readStoredMode());
    setIds(readStoredThemeIds());
  }, []);

  useDismissOnOutside(open, () => setOpen(false), boxRef);

  const choose = useCallback((nextMode: ThemeMode, id: string) => {
    setMode(nextMode);
    setIds((prev) => ({ ...prev, [nextMode]: id }));
    applyTheme(nextMode, id);
    try {
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
    <div className={css.palette} ref={boxRef}>
      <button
        type="button"
        className={css.paletteBtn}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={css.swatch} aria-hidden />
        <span className={css.paletteLabel}>{label}</span>
      </button>

      {open && (
        <div className={css.paletteMenu} role="menu">
          <div className={css.paletteModes}>
            {(["light", "dark"] as ThemeMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={css.modeBtn}
                aria-pressed={mode === m}
                onClick={() => choose(m, m === "dark" ? ids.dark : ids.light)}
              >
                {m === "dark" ? "Dark" : "Light"}
              </button>
            ))}
          </div>
          <div className={css.paletteList}>
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={o.id === current}
                className={css.paletteItem}
                onClick={() => choose(mode, o.id)}
              >
                {/* The real attribute: themes.css keys off `[data-theme=…]`
                    with a bare selector, so this span is painted in that
                    palette and the swatch shows its actual accent. */}
                <span className={css.swatch} data-theme={o.id} aria-hidden />
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
