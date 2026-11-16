/**
 * Which keys delete a canvas's selection. React Flow takes `deleteKeyCode`
 * from the window, so the canvas offers the keys only while the person can
 * see it, is working inside it, and is not typing in a card.
 */
export function deleteKeysFor(state: { screenActive: boolean; focusWithin: boolean; editing: boolean }): string[] | null {
  return state.screenActive && state.focusWithin && !state.editing ? ["Backspace", "Delete"] : null;
}
