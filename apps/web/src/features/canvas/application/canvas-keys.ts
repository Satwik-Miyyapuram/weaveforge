export type CanvasKeyAction =
  | { kind: "delete" }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "nudge"; dx: number; dy: number };

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * What a key does to the canvas. The canvas listens on the window, so it takes
 * keys only while the person can see it and is working inside it, and never
 * while they type in a card's text or a field (the toolbar's path and address
 * boxes included). Delete and Backspace remove the selection, Ctrl+Z undoes,
 * Ctrl+Shift+Z or Ctrl+Y redoes, and the arrows nudge the selection one page
 * pixel (ten with Shift).
 */
export function canvasKeyAction(
  state: { screenActive: boolean; focusWithin: boolean; editing: boolean; textEntry: boolean },
  press: { key: string; ctrl: boolean; shift: boolean },
): CanvasKeyAction | null {
  if (!state.screenActive || !state.focusWithin || state.editing || state.textEntry) return null;
  if (press.ctrl) {
    const key = press.key.toLowerCase();
    if (key === "z") return { kind: press.shift ? "redo" : "undo" };
    return key === "y" ? { kind: "redo" } : null;
  }
  if (press.key === "Backspace" || press.key === "Delete") return { kind: "delete" };
  const arrow = ARROWS[press.key];
  if (!arrow) return null;
  const step = press.shift ? 10 : 1;
  return { kind: "nudge", dx: arrow[0] * step, dy: arrow[1] * step };
}

/**
 * Whether a press on the canvas moves focus to its pane, so the delete keys
 * reach it. A hidden canvas never takes focus, and a press inside a text field
 * keeps the field's focus.
 */
export function focusesOnPress(state: { screenActive: boolean; textEntry: boolean }): boolean {
  return state.screenActive && !state.textEntry;
}
