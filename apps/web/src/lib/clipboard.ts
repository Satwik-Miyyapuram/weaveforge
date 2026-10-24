/**
 * Copy text to the clipboard and answer whether it got there.
 *
 * The clipboard can be missing (an insecure page, an old webview) or refuse
 * (no permission, the window lost focus). Callers show "Copied" only on true.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    const clip = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clip?.writeText) return false;
    await clip.writeText(text);
    return true;
  } catch {
    return false;
  }
}
