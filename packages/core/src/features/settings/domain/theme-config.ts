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

/** Named colors worth supporting; anything longer is a typo or an attack. */
const NAMED_COLORS = new Set(["transparent", "currentcolor", "white", "black"]);

/** A single font family name, unquoted. Deliberately narrow. */
const FONT_FAMILY_NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/;

const GENERIC_FONT_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
]);

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

/** Keys that would poison `Object.prototype` if copied onto a plain object. */
const POISON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/* ------------------------------------------------------------------ *
 * Parser
 * ------------------------------------------------------------------ */

class Problems {
  readonly list: string[] = [];
  add(path: string, message: string): void {
    if (this.list.length < 50) this.list.push(`${path}: ${message}`);
  }
  get ok(): boolean {
    return this.list.length === 0;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Byte length without depending on Buffer (this package runs in browsers). */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function hasPoisonKey(value: unknown, depth = 0): boolean {
  if (depth > 6 || !isPlainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (POISON_KEYS.has(key)) return true;
    if (hasPoisonKey(value[key], depth + 1)) return true;
  }
  return false;
}

function looksHostile(value: string): boolean {
  const lowered = value.toLowerCase();
  return FORBIDDEN_FRAGMENTS.some((fragment) => lowered.includes(fragment));
}

/** Colors: hex, numeric-argument rgb/hsl, or one of four keywords. */
export function normalizeColorValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_VALUE_LENGTH || looksHostile(value)) return null;
  if (HEX_COLOR.test(value)) return value.toLowerCase();
  if (NAMED_COLORS.has(value.toLowerCase())) return value.toLowerCase();
  if (FUNCTIONAL_COLOR.test(value)) return value.replace(/\s+/g, " ");
  return null;
}

/**
 * Font stacks: up to five families, each either a generic keyword or a name
 * matching {@link FONT_FAMILY_NAME}. The returned stack is rebuilt from the
 * accepted names — names containing a space are re-quoted here rather than
 * trusting whatever quoting the file used.
 */
export function normalizeFontStack(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_VALUE_LENGTH || looksHostile(value)) return null;

  const parts = value.split(",");
  if (parts.length > 5) return null;

  const families: string[] = [];
  for (const part of parts) {
    const bare = part.trim().replace(/^['"]|['"]$/g, "").trim();
    if (!bare) return null;
    if (GENERIC_FONT_FAMILIES.has(bare.toLowerCase())) {
      families.push(bare.toLowerCase());
      continue;
    }
    if (!FONT_FAMILY_NAME.test(bare)) return null;
    families.push(bare.includes(" ") ? `"${bare}"` : bare);
  }
  return families.length ? families.join(", ") : null;
}

/**
 * Lengths for radii. A unitless value is read as px. Ranges are clamped by
 * rejection rather than silent clamping so the user learns the limit.
 */
export function normalizeLengthValue(raw: unknown, maxPx = 64): string | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0 || raw > maxPx) return null;
    return `${raw}px`;
  }
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 16 || looksHostile(value)) return null;
  const match = LENGTH.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2] ?? "px";
  if (!Number.isFinite(amount) || amount < 0) return null;
  const limit = unit === "px" ? maxPx : maxPx / 16;
  if (amount > limit) return null;
  return `${amount}${amount === 0 ? "px" : unit}`;
}

/** Strip control characters from a display string; length-capped by caller. */
function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Control characters, written as escapes: literal ones in the source make
  // git treat this whole file as binary and hide it from grep.
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_NAME_LENGTH);
}

function parseSection<K extends string>(
  problems: Problems,
  raw: unknown,
  path: string,
  allowed: readonly K[],
  normalize: (value: unknown) => string | null,
  toVarName: (key: K) => string,
  vars: Record<string, string>,
): void {
  if (raw === undefined) return;
  if (!isPlainObject(raw)) {
    problems.add(path, "must be an object");
    return;
  }
  const entries = Object.entries(raw);
  if (entries.length > MAX_ENTRIES_PER_SECTION) {
    problems.add(path, `too many entries (max ${MAX_ENTRIES_PER_SECTION})`);
    return;
  }
  const allowedSet = new Set<string>(allowed);
  for (const [key, value] of entries) {
    if (!allowedSet.has(key)) {
      problems.add(`${path}.${key}`, "unknown key");
      continue;
    }
    const normalized = normalize(value);
    if (normalized === null) {
      problems.add(`${path}.${key}`, "value is not an accepted format");
      continue;
    }
    vars[toVarName(key as K)] = normalized;
  }
}

const TOP_LEVEL_KEYS = new Set([
  "version",
  "name",
  "mode",
  "surfaces",
  "motion",
  "colors",
  "fonts",
  "radius",
]);

/**
 * Parse and validate an uploaded theme file.
 *
 * Returns `{ config: null, errors }` on any problem — a partially applied
 * theme is worse than a rejected one, because half a palette is unreadable.
 */
export function parseThemeConfig(text: string): ThemeConfigParseResult {
  const problems = new Problems();

  if (typeof text !== "string" || !text.trim()) {
    return { config: null, errors: ["file: is empty"] };
  }
  if (byteLength(text) > THEME_CONFIG_MAX_BYTES) {
    return {
      config: null,
      errors: [`file: larger than ${Math.floor(THEME_CONFIG_MAX_BYTES / 1024)} KB`],
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { config: null, errors: ["file: is not valid JSON"] };
  }

  if (!isPlainObject(raw)) {
    return { config: null, errors: ["file: must be a JSON object"] };
  }
  if (hasPoisonKey(raw)) {
    return { config: null, errors: ["file: contains a reserved key"] };
  }

  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.has(key)) problems.add(key, "unknown key");
  }

  if (raw.version !== THEME_CONFIG_VERSION) {
    problems.add("version", `must be ${THEME_CONFIG_VERSION}`);
  }

  const name = normalizeName(raw.name) ?? "Custom theme";

  const mode = raw.mode === undefined ? "dark" : raw.mode;
  if (mode !== "light" && mode !== "dark") {
    problems.add("mode", 'must be "light" or "dark"');
  }

  const surfaces = raw.surfaces === undefined ? "borderless" : raw.surfaces;
  if (surfaces !== "borderless" && surfaces !== "bordered") {
    problems.add("surfaces", 'must be "borderless" or "bordered"');
  }

  let reactiveMotion = false;
  let motionScale = 1;
  if (raw.motion !== undefined) {
    if (!isPlainObject(raw.motion)) {
      problems.add("motion", "must be an object");
    } else {
      for (const key of Object.keys(raw.motion)) {
        if (key !== "reactive" && key !== "scale") problems.add(`motion.${key}`, "unknown key");
      }
      const { reactive, scale } = raw.motion;
      if (reactive !== undefined) {
        if (typeof reactive !== "boolean") problems.add("motion.reactive", "must be a boolean");
        else reactiveMotion = reactive;
      }
      if (scale !== undefined) {
        if (typeof scale !== "number" || !Number.isFinite(scale) || scale < 0.5 || scale > 2) {
          problems.add("motion.scale", "must be a number between 0.5 and 2");
        } else {
          motionScale = Math.round(scale * 100) / 100;
        }
      }
    }
  }

  const vars: Record<string, string> = Object.create(null) as Record<string, string>;
  parseSection(problems, raw.colors, "colors", THEME_COLOR_KEYS, normalizeColorValue, (k) => `--${k}`, vars);
  parseSection(problems, raw.fonts, "fonts", THEME_FONT_KEYS, normalizeFontStack, (k) => `--font-${k}`, vars);
  parseSection(
    problems,
    raw.radius,
    "radius",
    THEME_RADIUS_KEYS,
    (value) => normalizeLengthValue(value, 999),
    (k) => `--radius-${k}`,
    vars,
  );

  if (!problems.ok) return { config: null, errors: problems.list };

  return {
    config: {
      name,
      mode: mode as "light" | "dark",
      surfaces: surfaces as SurfaceStyle,
      reactiveMotion,
      motionScale,
      // Re-materialise as a normal object; `vars` is prototype-less by design
      // but the value crosses into JSON persistence, which wants a plain one.
      vars: { ...vars },
    },
    errors: [],
  };
}

/**
 * Re-validate a config that came back from persistence. The stored row is
 * writable by whoever owns the account, so it gets the same treatment as the
 * original upload rather than being trusted because it "already passed once".
 */
export function normalizeThemeConfig(raw: unknown): ThemeConfig | null {
  if (!isPlainObject(raw)) return null;
  const rebuilt = {
    version: THEME_CONFIG_VERSION,
    name: raw.name,
    mode: raw.mode,
    surfaces: raw.surfaces,
    motion: { reactive: raw.reactiveMotion, scale: raw.motionScale },
    ...splitVars(raw.vars),
  };
  return parseThemeConfig(JSON.stringify(rebuilt)).config;
}

/** Turn a flat `--token` map back into the sectioned upload shape. */
function splitVars(vars: unknown): {
  colors: Record<string, unknown>;
  fonts: Record<string, unknown>;
  radius: Record<string, unknown>;
} {
  const colors: Record<string, unknown> = {};
  const fonts: Record<string, unknown> = {};
  const radius: Record<string, unknown> = {};
  if (isPlainObject(vars)) {
    for (const [key, value] of Object.entries(vars)) {
      if (key.startsWith("--font-")) fonts[key.slice("--font-".length)] = value;
      else if (key.startsWith("--radius-")) radius[key.slice("--radius-".length)] = value;
      else if (key.startsWith("--")) colors[key.slice(2)] = value;
    }
  }
  return { colors, fonts, radius };
}

/** A documented starter file, offered as a download from settings. */
export function themeConfigTemplate(): string {
  return JSON.stringify(
    {
      version: THEME_CONFIG_VERSION,
      name: "My theme",
      mode: "dark",
      surfaces: "borderless",
      motion: { reactive: true, scale: 1 },
      colors: {
        bg: "#0b0d12",
        surface: "#12151c",
        surface2: "#1a1f29",
        elev: "#161b23",
        border: "#2a3140",
        "border-strong": "#3d465a",
        text: "#e8ecf4",
        muted: "#9aa5b8",
        faint: "#6b7688",
        accent: "#6ea8fe",
        "accent-fg": "#0b0d12",
        "accent-soft": "#1b2740",
      },
      fonts: {
        sans: "IBM Plex Sans, system-ui, sans-serif",
        serif: "IBM Plex Serif, serif",
        mono: "IBM Plex Mono, ui-monospace, monospace",
      },
      radius: { card: "14px", control: "10px", chip: "999px" },
    },
    null,
    2,
  );
}
