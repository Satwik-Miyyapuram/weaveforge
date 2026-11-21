import { createContext, useContext } from "react";

/**
 * Whether the document around a component is the shown tab of the focused pane.
 *
 * Panes keep every tab mounted (`pane-view.tsx`), so window-wide shortcuts in
 * each document would all fire on one keypress. They check this first.
 * Outside a pane nothing provides it and it is `true`.
 */
export const PaneFocusedContext = createContext(true);

export function usePaneFocused(): boolean {
  return useContext(PaneFocusedContext);
}
