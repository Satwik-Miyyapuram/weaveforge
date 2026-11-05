import { readyCore } from "@/lib/rust-core";

/** "Untitled", or "Untitled (2)" and on when the project already has one. */
export function untitledTitle(existing: readonly string[]): string {
  return readyCore().uniqueTitle("Untitled", new Set(existing.map(readyCore().normalizeTitleKey)));
}
