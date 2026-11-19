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
 * already clamped. `onWidth` follows every change; `onCommit` gets the width
 * to keep: at once for a key or double-click, once at the end of a drag.
 */
export function ExplorerResizer({
  width,
  onWidth,
  onCommit,
}: {
  width: number;
  onWidth: (width: number) => void;
  onCommit: (width: number) => void;
}) {
  const set = (next: number) => {
    const clamped = clampExplorerWidth(next);
    onWidth(clamped);
    onCommit(clamped);
  };
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
        let last: number | null = null;
        followPointer(window, (move) => {
          last = clampExplorerWidth(startWidth + move.clientX - startX);
          onWidth(last);
        });
        const end = () => {
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
          if (last != null) onCommit(last);
        };
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
      }}
      onDoubleClick={() => set(EXPLORER_WIDTH_DEFAULT)}
    />
  );
}
