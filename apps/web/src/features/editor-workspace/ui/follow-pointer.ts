/**
 * Follow a drag's pointer moves on `target` (the window) until the pointer is
 * released or the system cancels it (touch, pen, a gesture). Listening only
 * for `pointerup` left `move` attached after a cancel, so later moves kept
 * resizing. Returns the teardown, safe to call more than once.
 */
export function followPointer(
  target: EventTarget,
  onMove: (event: PointerEvent) => void,
): () => void {
  const move = (event: Event) => onMove(event as PointerEvent);
  const stop = () => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", stop);
    target.removeEventListener("pointercancel", stop);
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", stop);
  target.addEventListener("pointercancel", stop);
  return stop;
}
