/**
 * Shortcut text for the platform it is read on (E29). Chords are written once
 * with Mac glyphs (`⌘⇧F`); Windows and Linux read them as `Ctrl+Shift+F`,
 * since `⌘` means nothing on their keyboards. The handlers already accept
 * either modifier, so only the label changes.
 */

const WORDS: Record<string, string> = { "⌘": "Ctrl", "⌃": "Ctrl", "⇧": "Shift", "⌥": "Alt", "⇥": "Tab" };

/** Whether this is a Mac. Without a navigator (prerender) it is not. */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** One keycap: `⌘` → `Ctrl` off a Mac. */
export function keyLabel(key: string, mac = isMacPlatform()): string {
  return mac ? key : (WORDS[key] ?? key);
}

/** A whole chord: `⌘⇧F` → `Ctrl+Shift+F` off a Mac. */
export function shortcutLabel(chord: string, mac = isMacPlatform()): string {
  if (mac) return chord;
  return [...chord].map((key) => WORDS[key] ?? key).join("+");
}
