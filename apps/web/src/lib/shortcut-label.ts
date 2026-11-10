/**
 * Whether the page runs on a Mac. The shortcut label rules (`keyLabel`,
 * `shortcutLabel`) live in Rust (`wf-core` `shortcut_label`) and are called
 * through `readyCore()`; only the browser check stays in TypeScript.
 */

/** Whether this is a Mac. Without a navigator (prerender) it is not. */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}
