/**
 * Theme config parsing (Rust `settings::theme_config`), re-exported from index.ts. Keeps the
 * signatures of packages/core/src/features/settings/domain/theme-config.ts.
 * Types come from ./bindings.ts.
 */
import {
  parseThemeConfig as rawParseThemeConfig,
  normalizeColorValue as rawNormalizeColorValue,
  normalizeFontStack as rawNormalizeFontStack,
  normalizeLengthValue as rawNormalizeLengthValue,
  normalizeThemeConfig as rawNormalizeThemeConfig,
  themeConfigTemplate as rawThemeConfigTemplate,
} from "../pkg/wf_wasm.js";
import type { ThemeConfig, ThemeConfigParseResult } from "./bindings.js";

/** Parse and validate an uploaded theme file; any problem rejects the whole file. */
export function parseThemeConfig(text: string): ThemeConfigParseResult {
  return rawParseThemeConfig(text) as ThemeConfigParseResult;
}

/** Colors: hex, numeric-argument rgb/hsl, or one of four keywords; null otherwise. */
export function normalizeColorValue(raw: unknown): string | null {
  return rawNormalizeColorValue(raw) ?? null;
}

/** Font stacks of up to five safe family names; null otherwise. */
export function normalizeFontStack(raw: unknown): string | null {
  return rawNormalizeFontStack(raw) ?? null;
}

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

/** A documented starter file, offered as a download from settings. */
export function themeConfigTemplate(): string {
  return rawThemeConfigTemplate();
}
