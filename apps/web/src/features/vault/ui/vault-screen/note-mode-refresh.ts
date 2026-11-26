/**
 * Whether a note's mode switch reloads the notes list. Only a body saved since the last
 * reload changes the list, and only Read takes it: Text and Ink swap at once, with no
 * project reload racing the ink surface. A note left in Text or Ink reloads when it closes.
 */
export function refreshOnModeChange(next: string, saved: boolean): boolean {
  return saved && next === "read";
}
