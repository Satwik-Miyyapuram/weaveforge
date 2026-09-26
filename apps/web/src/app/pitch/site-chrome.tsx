"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import s from "./scrolly.module.css";
import { DARK_THEME_OPTIONS, LIGHT_THEME_OPTIONS } from "@/lib/theme/theme";
import { useDismissOnOutside } from "@/lib/hooks/use-dismiss-on-outside";

/**
 * The pieces the pitch and the docs share: the brand mark, the theme and its
 * picker, and the GitHub link. The docs live in another tree (apps/pitch) but
 * are the same site, so a theme picked on one is the theme on the other.
 */

/**
 * The page's theme: any of the app's, or "auto" to follow the system between
 * Poster and Poster dark. Remembered under the site's own key, never the app's
 * theme keys, so trying one here does not change a signed-in reader's app.
 */
const THEME_KEY = "wf-pitch-theme";
const AUTO = "auto";
const THEME_IDS = new Set<string>([...LIGHT_THEME_OPTIONS, ...DARK_THEME_OPTIONS].map((o) => o.id));

/** Poster, Poster dark and CRT are the site's own looks; the rest borrow the app's theme tokens. */
export function themeAttrs(theme: string): { "data-look"?: string; "data-theme"?: string } {
  if (theme === AUTO) return {};
  if (theme === "brutal") return { "data-look": "light" };
  if (theme === "brutal-dark") return { "data-look": "dark" };
  if (theme === "crt") return { "data-look": "crt" };
  return { "data-theme": theme };
}

function themeLabel(theme: string): string {
  if (theme === AUTO) return "Auto";
  return [...LIGHT_THEME_OPTIONS, ...DARK_THEME_OPTIONS].find((o) => o.id === theme)?.label ?? "Theme";
}

/** The stored theme, and a setter that remembers it. */
export function useSiteTheme(): [string, (next: string) => void] {
  const [theme, setTheme] = useState<string>(AUTO);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored && THEME_IDS.has(stored)) setTheme(stored);
    } catch {
      /* storage blocked: the default look stands */
    }
  }, []);

  const pick = useCallback((next: string) => {
    setTheme(next);
    try {
      if (next === AUTO) localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage blocked: the choice lasts until reload */
    }
    // CRT sets titles in a different face, so anything measured refits.
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }, []);

  return [theme, pick];
}

export function ThemePicker({ theme, onPick }: { theme: string; onPick: (theme: string) => void }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(open, () => setOpen(false), boxRef);
  const pick = (id: string) => {
    onPick(id);
    setOpen(false);
  };
  const item = (id: string, label: string) => (
    <button key={id} type="button" role="menuitemradio" aria-checked={theme === id} onClick={() => pick(id)}>
      {/* The swatch carries the theme's own attribute, so it is painted from
          that theme's tokens: its ground and its accent. */}
      <span className={s.swatch} data-theme={id === AUTO ? undefined : id} aria-hidden />
      {label}
    </button>
  );
  return (
    <div className={s.picker} ref={boxRef}>
      <button
        type="button"
        className={s["picker-btn"]}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${themeLabel(theme)}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={s.swatch} data-theme={theme === AUTO ? undefined : theme} aria-hidden />
        <span className={s["picker-label"]}>{themeLabel(theme)}</span>
      </button>
      {open && (
        <div className={s["picker-menu"]} role="menu" aria-label="Theme">
          {item(AUTO, "Auto")}
          <p className={s["picker-group"]}>Light</p>
          {LIGHT_THEME_OPTIONS.map((o) => item(o.id, o.label))}
          <p className={s["picker-group"]}>Dark</p>
          {DARK_THEME_OPTIONS.map((o) => item(o.id, o.label))}
        </div>
      )}
    </div>
  );
}

/**
 * The WeaveForge mark (the app's icon, see components/weave-forge-logo.tsx)
 * without its tile, drawn in the text colour so it sits on any look. The one
 * accent node is a ring in the look's primary, which reads on light and dark.
 */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="120 105 272 324" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M230 125H194a54 54 0 0 0-54 54v176a54 54 0 0 0 54 54h124a54 54 0 0 0 54-54v-90" strokeWidth="28" />
      <path d="M264 125v90l92-76M264 215l108 14" strokeWidth="16" />
      <circle cx="264" cy="125" r="25" fill="currentColor" stroke="none" />
      <circle cx="264" cy="215" r="25" fill="currentColor" stroke="none" />
      <circle cx="372" cy="229" r="25" fill="currentColor" stroke="none" />
      <circle cx="356" cy="139" r="27" fill="var(--primary)" strokeWidth="14" />
    </svg>
  );
}

export function GitHubMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
