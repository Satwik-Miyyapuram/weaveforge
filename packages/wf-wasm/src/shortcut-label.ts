/**
 * Shortcut text for a platform (Rust `shortcut_label`), re-exported from index.ts.
 */
import { keyLabel as rawKeyLabel, shortcutLabel as rawShortcutLabel } from "../pkg/wf_wasm.js";

/** One keycap: `⌘` reads `Ctrl` off a Mac. */
export function keyLabel(key: string, mac: boolean): string {
  return rawKeyLabel(key, mac);
}

/** A whole chord: `⌘⇧F` reads `Ctrl+Shift+F` off a Mac. */
export function shortcutLabel(chord: string, mac: boolean): string {
  return rawShortcutLabel(chord, mac);
}
