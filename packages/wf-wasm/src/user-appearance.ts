/**
 * Appearance preferences (Rust `settings::user_appearance`), re-exported from index.ts.
 * Keeps the signatures of packages/core/src/features/settings/domain/user-appearance.ts.
 * Types come from ./bindings.ts.
 */
import { normalizeAppearance as rawNormalizeAppearance } from "../pkg/wf_wasm.js";
import type { UserAppearance } from "./bindings.js";

/** Plain JSON only, as the stored row is JSON. */
function plain(raw: unknown): unknown {
  return raw === undefined ? undefined : JSON.parse(JSON.stringify(raw) ?? "null");
}

/** The valid appearance preferences of a stored value; undefined when none are. */
export function normalizeAppearance(raw: unknown): UserAppearance | undefined {
  return (rawNormalizeAppearance(plain(raw)) ?? undefined) as UserAppearance | undefined;
}
