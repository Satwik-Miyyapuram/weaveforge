import { normalizeTitleKey, uniqueTitle } from "@weaveforge/core";

/** "Untitled", or "Untitled (2)" and on when the project already has one. */
export function untitledTitle(existing: readonly string[]): string {
  return uniqueTitle("Untitled", new Set(existing.map(normalizeTitleKey)));
}
