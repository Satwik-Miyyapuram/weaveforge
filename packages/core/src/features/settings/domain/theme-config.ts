/** Types for theme-config. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

/**
 * User-uploadable theme config (`config.json`) and its parser.
 *
 * This file is the trust boundary for the upload feature: a theme file is a
 * *file the user picked off disk*, so it is treated exactly like any other
 * untrusted input. The parser never hands raw text to the styling layer.
 * Instead it returns a normalized record of CSS custom properties whose
 * **names come from allowlists in this file** and whose **values are
 * re-serialized from parsed pieces**, never passed through verbatim where a
 * pass-through could carry syntax.
 *
 * That shape is what makes the applier safe: it only ever calls
 * `style.setProperty("--" + knownKey, checkedValue)`. There is no code path
 * that concatenates config text into a stylesheet, so a value cannot break out
 * of its declaration, and a key cannot become a selector or an `@import`.
 *
 * Defence in depth, in order of application:
 *   1. Byte cap before `JSON.parse` — an unbounded parse is a DoS.
 *   2. Structural checks: plain object, no arrays, no prototype-polluting keys,
 *      bounded nesting and entry counts.
 *   3. Key allowlists — an unknown key is an error, not something ignored, so
 *      typos surface instead of silently doing nothing.
 *   4. Value grammars — hex/rgb/hsl colors, font stacks, bounded lengths.
 *   5. Re-serialization — the emitted value is rebuilt from the matched parts.
 */

/** Hard cap on an uploaded file. Anything real is well under 8 KB. */
export const THEME_CONFIG_MAX_BYTES = 64 * 1024;

/** Only this version is understood; a future file must say so explicitly. */
export const THEME_CONFIG_VERSION = 1;

/**
 * Raw palette tokens a config may override. Mirrors the per-theme token block
 * in `app/themes/`. Aliases (`--ink`, `--line`, …) are deliberately absent:
 * they derive from these, so letting a config set both invites a palette that
 * contradicts itself.
 */
export const THEME_COLOR_KEYS = [
  "bg",
  "surface",
  "surface2",
  "elev",
  "border",
  "border-strong",
  "text",
  "muted",
  "faint",
  "accent",
  "accent-fg",
  "accent-soft",
  "s-neutral",
  "s-neutral-bg",
  "s-info",
  "s-info-bg",
  "s-good",
  "s-good-bg",
  "s-warn",
  "s-warn-bg",
  "s-danger",
  "s-danger-bg",
  "s-mute",
  "s-mute-bg",
] as const;

/** Font slots. Each maps to the `--font-*` custom property of the same name. */
export const THEME_FONT_KEYS = ["sans", "serif", "mono"] as const;

/** Geometry slots, in the same spirit as the font slots. */
export const THEME_RADIUS_KEYS = ["card", "control", "chip"] as const;

/** How surfaces are separated from each other. */
export type SurfaceStyle = "borderless" | "bordered";

export interface ThemeConfig {
  /** Display name, shown in settings once the file is applied. */
  name: string;
  /** Which mode the palette is written for; drives the light/dark base. */
  mode: "light" | "dark";
  /** Border treatment the theme prefers. High contrast wants "bordered". */
  surfaces: SurfaceStyle;
  /** Whether the pointer-reactive animation layer is on for this theme. */
  reactiveMotion: boolean;
  /** Global animation duration multiplier, 0.5–2. */
  motionScale: number;
  /**
   * Whether paper and note cards lean a little, like dealt cards. Unset
   * leaves it to the theme: CRT leans them, the others keep them square.
   */
  cardTilt?: boolean;
  /**
   * CSS custom properties to set on `<html>`, already validated and
   * re-serialized. Keys include the leading `--`.
   */
  vars: Record<string, string>;
}

export interface ThemeConfigParseResult {
  config: ThemeConfig | null;
  /** Human-readable problems, each prefixed with the path that failed. */
  errors: string[];
}

/* ------------------------------------------------------------------ *
 * Value grammars
 * ------------------------------------------------------------------ */

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * `rgb()/rgba()/hsl()/hsla()` restricted to numeric arguments. The body may
 * only contain digits, separators and units — no nested functions, so `var()`,
 * `url()` and `calc()` cannot appear inside.
 */
const FUNCTIONAL_COLOR = /^(rgba?|hsla?)\(\s*[0-9.,%\s/deg]+\)$/i;

/** A single font family name, unquoted. Deliberately narrow. */
const FONT_FAMILY_NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/;

const LENGTH = /^(0|[0-9]{1,3}(?:\.[0-9]{1,2})?)(px|rem|em)?$/;

/**
 * Substrings that must never survive into a declaration, checked before the
 * grammars as a blunt second line. The grammars above already exclude these;
 * this catches a future loosening of one of them.
 */
const FORBIDDEN_FRAGMENTS = [
  "url(",
  "var(",
  "expression",
  "javascript:",
  "@import",
  "\\",
  ";",
  "{",
  "}",
  "<",
  ">",
  "/*",
  "*/",
];

const MAX_VALUE_LENGTH = 120;

const MAX_NAME_LENGTH = 60;

const MAX_ENTRIES_PER_SECTION = 64;

