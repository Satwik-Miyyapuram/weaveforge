import {
  EXPLORER_WIDTH_DEFAULT,
  EXPLORER_WIDTH_MAX,
  EXPLORER_WIDTH_MIN,
  clampExplorerWidth,
} from "../application/parts";
import { followPointer } from "./follow-pointer";

/** How far one arrow press moves the edge. */
export const EXPLORER_WIDTH_STEP = 16;

/**
 * The explorer's right edge: drag it, step it with the arrow keys (Home/End
 * for the bounds), double-click to put it back. The same separator the pane
 * splits use (`.pane-divider`, `followPointer`); every width it reports is
 * already clamped.
 */
export function ExplorerResizer({ width, onWidth }: { width: number; onWidth: (width: number) => void }) {
  const set = (next: number) => onWidth(clampExplorerWidth(next));
  return (
    <div
      className="pane-divider explorer-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize explorer"
      aria-valuenow={width}
      aria-valuemin={EXPLORER_WIDTH_MIN}
      aria-valuemax={EXPLORER_WIDTH_MAX}
      tabIndex={0}
      onKeyDown={(event) => {
        const next =
          event.key === "ArrowLeft" ? width - EXPLORER_WIDTH_STEP
          : event.key === "ArrowRight" ? width + EXPLORER_WIDTH_STEP
          : event.key === "Home" ? EXPLORER_WIDTH_MIN
          : event.key === "End" ? EXPLORER_WIDTH_MAX
          : null;
        if (next == null) return;
        event.preventDefault();
        set(next);
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const startX = event.clientX;
        const startWidth = width;
        followPointer(window, (move) => set(startWidth + move.clientX - startX));
      }}
      onDoubleClick={() => onWidth(EXPLORER_WIDTH_DEFAULT)}
    />
  );
}
