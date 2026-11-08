export interface BoxSize {
  width: number;
  height: number;
}

/**
 * What the reader does when its scroll container changes size.
 *
 * A background editor tab is display:none, so it reads 0 wide; fitting to that
 * shrinks the page to the smallest zoom. Keep the last fit instead, and refit
 * at once when the tab is shown again. Any other resize is usually an
 * animation, so it waits for the size to settle.
 */
export function containerResize(last: BoxSize, next: BoxSize): "ignore" | "now" | "settle" {
  if (next.width === last.width && next.height === last.height) return "ignore";
  if (next.width === 0) return "ignore";
  return last.width === 0 ? "now" : "settle";
}
