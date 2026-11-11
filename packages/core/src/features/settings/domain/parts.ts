import type { SearchSettings } from "../../../search/parts.js";
import type { AiAccessSettings } from "../../ai-assistant/domain/parts.js";

// --- theme-config ---
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

// --- parts ---
// --- privacy-disclaimer ---
/** Types for privacy-disclaimer. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
/** Bump when disclaimer copy changes materially — users must re-accept. */
export const CURRENT_DISCLAIMER_VERSION = 5;

// --- user-appearance ---
/** Types for user-appearance. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
/** Icon / toggle button densities, smallest first. */
export const CONTROL_SIZES = ["compact", "default", "comfortable"] as const;

/** Per-user light/dark mode, theme variant, and control density preferences. */
export type ControlSize = (typeof CONTROL_SIZES)[number];

/** How the brutal and CRT themes may colour a paper card by its reading status. */
export const CARD_TINTS = ["full", "bar", "border", "none"] as const;

/** How the brutal and CRT themes colour a paper card by its reading status. */
export type CardTint = (typeof CARD_TINTS)[number];

/** Animation speed multipliers, slowest first; 1 is the designed speed. */
export const ANIMATION_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

/** How fast every animation runs relative to its designed duration. */
export type AnimationSpeed = (typeof ANIMATION_SPEEDS)[number];

export interface UserAppearance {
  mode?: "light" | "dark";
  lightTheme?: string;
  darkTheme?: string;
  /** Icon / toggle button scale across the app. */
  controlSize?: ControlSize;
  /**
   * Surface separation. "borderless" separates panels with elevation alone;
   * "bordered" restores the hairlines, which high-contrast users need because
   * a shadow carries almost no contrast ratio.
   */
  surfaces?: SurfaceStyle;
  /**
   * Pointer-reactive animation layer (tilt, cursor glow, press physics). Off by
   * default: it is additive polish, not part of the motion the app already had.
   */
  reactiveMotion?: boolean;
  /** Every animation's speed, 0.25x to 4x. Absent means 1x. */
  animationSpeed?: AnimationSpeed;
  /**
   * Paper card status colour on the brutal and CRT themes: the whole card
   * tinted, a bar down its edge, or nothing. Other themes ignore it.
   */
  cardTint?: CardTint;
  /**
   * CRT's leaning cards. On by default there; off squares them up. Only the
   * CRT theme reads it — a theme file can lean cards on any theme.
   */
  cardTilt?: boolean;
  /** CRT's scanline overlay. On by default; other themes have none. */
  scanlines?: boolean;
  /**
   * Validated theme uploaded as `config.json`. Absent means "unchanged";
   * explicit `null` means "remove the uploaded theme", which a patch needs to
   * be able to say without being read as "leave it alone".
   */
  customTheme?: ThemeConfig | null;
}

// --- user-settings ---
/** Types for user-settings. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
export interface UserSettings {
  /**
   * Provider-keyed credential bags (e.g. `{ zotero: { apiKey, library } }`).
   * Legacy flat columns remain in sync for existing DB rows.
   */
  integrations?: Record<string, Record<string, string>>;
  /** Zotero Web API key (zotero.org/settings/keys). */
  zoteroApiKey?: string;
  /** Zotero library path, e.g. "users/123456" or "groups/789". */
  zoteroLibrary?: string;
  /** Optional Semantic Scholar API key for higher rate limits. */
  semanticScholarKey?: string;
  /** ISO timestamp when the user accepted the org/privacy disclaimer. */
  disclaimerAcceptedAt?: string;
  /** Version of the disclaimer the user accepted (see CURRENT_DISCLAIMER_VERSION). */
  disclaimerVersion?: number;
  /** Light/dark mode and theme variant preferences. */
  appearance?: UserAppearance;
  /** Explicit, fail-closed access controls for the AI assistant. */
  aiAccess?: AiAccessSettings;
  /** Ranking preferences for workspace search. */
  search?: SearchSettings;
}

// --- settings-repository ---
/**
 * Repository contract for per-user settings (DIP). One record per user, so the
 * interface is get/save rather than id-keyed CRUD.
 */
export type SettingsMetadata = Pick<
  UserSettings,
  "disclaimerAcceptedAt" | "disclaimerVersion" | "appearance"
>;

export interface ISettingsRepository {
  /** The current user's settings; empty object if none saved yet. */
  get(): Promise<UserSettings>;
  /** Read non-secret settings that are safe before encryption unlock. */
  getMetadata(): Promise<SettingsMetadata>;
  /** Persist the current user's settings (full replace). */
  save(settings: UserSettings): Promise<void>;
  /** Persist only legal/disclaimer metadata before encryption is unlocked. */
  saveDisclaimer(acceptedAt: string, version: number): Promise<void>;
}
