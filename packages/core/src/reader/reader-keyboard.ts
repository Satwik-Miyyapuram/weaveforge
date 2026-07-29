/**
 * Map keyboard events to reader viewport commands.
 * Pure — no DOM. The UI binds these to the viewport controller.
 */

export type ReaderKeyboardCommand =
  | { type: "page_delta"; delta: number }
  | { type: "page_home" }
  | { type: "page_end" }
  | { type: "zoom_in" }
  | { type: "zoom_out" }
  | { type: "fit_width" }
  | { type: "rotate" };

export interface ReaderKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** True when the event target is an editable field. */
  fromEditable?: boolean;
}

/**
 * Tag names whose own keyboard handling must win over reader shortcuts.
 * `SELECT` matters as much as the text inputs: arrows change the selected
 * option and printable keys type-ahead, so swallowing them breaks the
 * annotation-tool and sidebar dropdowns.
 */
const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "OPTION"]);

/**
 * Whether an event target owns its keystrokes. Pure so the reader's DOM
 * handler and its tests agree on one rule.
 */
export function isEditableReaderTarget(
  target: { tagName?: string; isContentEditable?: boolean } | null | undefined,
): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return EDITABLE_TAGS.has((target.tagName ?? "").toUpperCase());
}

/**
 * Return a command for navigable keys, or null when the event should pass through.
 * Ignores events from editable fields so page-jump inputs keep working.
 */
export function readerKeyboardCommand(event: ReaderKeyEvent): ReaderKeyboardCommand | null {
  if (event.fromEditable) return null;
  if (event.altKey) return null;

  const key = event.key;
  if (key === "+" || key === "=") return { type: "zoom_in" };
  if (key === "-" || key === "_") return { type: "zoom_out" };
  if (key === "r" || key === "R") return { type: "rotate" };
  if (key === "0" && (event.ctrlKey || event.metaKey)) return { type: "fit_width" };

  switch (key) {
    case "ArrowDown":
    case "PageDown":
    case "j":
      return { type: "page_delta", delta: 1 };
    case "ArrowUp":
    case "PageUp":
    case "k":
      return { type: "page_delta", delta: -1 };
    case "Home":
      return { type: "page_home" };
    case "End":
      return { type: "page_end" };
    case "ArrowRight":
      return { type: "page_delta", delta: 1 };
    case "ArrowLeft":
      return { type: "page_delta", delta: -1 };
    default:
      return null;
  }
}
