import type { SearchSettings } from "../../../search/parts.js";
import type { AiAccessSettings } from "../../ai-assistant/index.js";
import type { SurfaceStyle, ThemeConfig } from "./theme-config.js";

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
