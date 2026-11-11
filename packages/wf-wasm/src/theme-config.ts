/**
 * Theme config parsing (Rust `settings::theme_config`), re-exported from index.ts. Keeps the
 * signatures of packages/core/src/features/settings/domain/theme-config.ts.
 * Types come from ./bindings.ts.
 */
import {
  normalizeLengthValue as rawNormalizeLengthValue,
  normalizeThemeConfig as rawNormalizeThemeConfig,
} from "../pkg/wf_wasm.js";
import type {
  ThemeConfig,
} from "./bindings.js";

export {
  normalizeColorValue,
  normalizeFontStack,
  parseThemeConfig,
  themeConfigTemplate,
} from "../pkg/wf_wasm.js";

/** Lengths such as `12px`, `0.5rem` or a px number, limited to `maxPx`; null otherwise. */
export function normalizeLengthValue(raw: unknown, maxPx = 64): string | null {
  return rawNormalizeLengthValue(raw, maxPx) ?? null;
}

/** A stored config re-checked as if uploaded again; null when it no longer passes. */
export function normalizeThemeConfig(raw: unknown): ThemeConfig | null {
  // Plain JSON only, as the TS copy rebuilds it through JSON.stringify.
  const plain: unknown = JSON.parse(JSON.stringify(raw) ?? "null");
  return rawNormalizeThemeConfig(plain) as ThemeConfig | null;
}

