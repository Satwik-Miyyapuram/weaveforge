import { useEffect, useRef, type RefObject } from "react";

/** Whether keys typed at `target` go into a field or a card's text, not the canvas. */
export function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable]") !== null);
}

/**
 * Whether space is held, as a ref (no re-render per key). Space in a text field
 * is typing, so it is ignored there. Releasing the window clears it, so a
 * missed key-up cannot leave the canvas stuck in pan.
 */
export function useSpaceHeld(): RefObject<boolean> {
  const held = useRef(false);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isTextEntry(event.target)) return;
      held.current = true;
      event.preventDefault();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") held.current = false;
    };
    const reset = () => {
      held.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
    };
  }, []);
  return held;
}
