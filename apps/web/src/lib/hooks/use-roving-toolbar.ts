"use client";

/**
 * A `role="toolbar"` that is one tab stop (WAI-ARIA toolbar pattern): Tab
 * enters at the control last used, the arrows walk the rest, Home and End jump
 * to the ends. Without it a bar of tools and swatches cost a dozen Tab presses
 * to cross.
 *
 * Spread the result on the toolbar element: `<div role="toolbar" {...roving}>`.
 */

import { useCallback, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent } from "react";

const CONTROLS = "button:not([disabled]), input:not([disabled]), select:not([disabled])";
/** The nearest of these above a control owns it: a nested bar or an open menu is not ours. */
const OWNERS = '[role="toolbar"], [role="menu"], [role="dialog"], [role="listbox"]';

/** The controls the toolbar itself holds, shown or not. */
function ownControls(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(CONTROLS)].filter((el) => el.closest(OWNERS) === root);
}

/** The controls the toolbar itself shows, in order. */
export function rovingItems(root: HTMLElement): HTMLElement[] {
  return ownControls(root).filter((el) => el.getClientRects().length > 0);
}

/** Make `current` (or, if it is gone, the first control) the only tab stop. */
export function syncTabStops(root: HTMLElement, current: HTMLElement | null): void {
  const items = rovingItems(root);
  const stop = current && items.includes(current) ? current : items[0];
  // Hidden ones too, so one that reappears is not a second stop.
  for (const el of ownControls(root)) el.tabIndex = el === stop ? 0 : -1;
}

/** Where `key` moves focus from `from`, or null when the key is not ours. */
export function rovingMove(root: HTMLElement, from: HTMLElement, key: string): HTMLElement | null {
  const items = rovingItems(root);
  const at = items.indexOf(from);
  if (at < 0) return null;
  const n = items.length;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return items[(at + 1) % n]!;
    case "ArrowLeft":
    case "ArrowUp":
      return items[(at - 1 + n) % n]!;
    case "Home":
      return items[0]!;
    case "End":
      return items[n - 1]!;
    default:
      return null;
  }
}

export function useRovingToolbar<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const current = useRef<HTMLElement | null>(null);

  // Controls come and go with the tool and the page, so re-mark after every render.
  useLayoutEffect(() => {
    if (ref.current) syncTabStops(ref.current, current.current);
  });

  const onFocus = useCallback((event: FocusEvent<T>) => {
    const root = ref.current;
    const target = event.target as HTMLElement;
    if (!root || !rovingItems(root).includes(target)) return;
    current.current = target;
    syncTabStops(root, target);
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent<T>) => {
    const root = ref.current;
    const target = event.target as HTMLElement;
    // A control that used the key itself (the dock button's arrows) keeps it,
    // and a text field keeps its arrows for the caret.
    if (!root || event.defaultPrevented || target.tagName === "INPUT" || target.tagName === "SELECT") return;
    const next = rovingMove(root, target, event.key);
    if (!next) return;
    event.preventDefault();
    next.focus();
  }, []);

  return { ref, onFocus, onKeyDown };
}
