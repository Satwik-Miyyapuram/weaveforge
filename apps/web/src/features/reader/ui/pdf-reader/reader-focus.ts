const FOCUSABLE = "[tabindex],a[href],button,input,select,textarea,[contenteditable]";

/**
 * Whether the reader's keys should answer: focus is nowhere, on the body, or
 * inside one of `roots` — the reader and its toolbar, which the Editor
 * portals out of the reader into the one shared bar. A reader on a screen kept
 * mounted but not on show (`useScreenActive`) never answers.
 */
export function ownsReaderFocus(
  active: Element | null,
  body: Element | null,
  roots: readonly (HTMLElement | null)[],
  screenActive = true,
): boolean {
  if (!screenActive) return false;
  if (!active || active === body) return true;
  return roots.some((root) => root?.contains(active) ?? false);
}

/**
 * What a press inside the reader should focus. The pen canvases cancel the
 * pointer's default, so the browser moves focus nowhere and a toolbar button
 * clicked earlier keeps it. A focusable control inside the reader takes its
 * own focus; anything else focuses the reader.
 */
export function pointerFocusTarget(target: Element, root: HTMLElement): HTMLElement | null {
  const own = target.closest<HTMLElement>(FOCUSABLE);
  return own && own !== root && root.contains(own) ? null : root;
}
