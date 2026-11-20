/**
 * Which presses pan the canvas. A pen never pans: its strokes always draw (or
 * select), so a stylus cannot drag the page. Mouse and touch pan with the
 * middle button, or with space held and a drag. Two fingers pan by their
 * midpoint (handled by the editor).
 */

export interface PanPress {
  button: number;
  pointerType: string;
  spaceHeld: boolean;
}

export function isPanPress(press: PanPress): boolean {
  if (press.pointerType === "pen") return false;
  return press.button === 1 || (press.button === 0 && press.spaceHeld);
}

export function midpoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
