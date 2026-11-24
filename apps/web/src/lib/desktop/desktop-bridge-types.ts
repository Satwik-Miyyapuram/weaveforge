/** Wire shapes of the desktop bridge; imported through `desktop-bridge.ts`. */

/** One of the app's own folders: `artifacts`, `models` or `log`. */
export interface DesktopStorageArea {
  id: string;
  bytes: number;
  files: number;
  /** The most the folder may hold before downloads into it are refused; null when uncapped. */
  limit?: number | null;
}

/**
 * The application log as the page receives it.
 *
 * `text` is the entries already formatted, one line each and oldest first, so
 * the page can show them without a second parser and a second answer to "what
 * does a log line look like". `file` is where they are also written, so the
 * reader can open the same record in an editor.
 */
export interface DesktopAppLog {
  file: string;
  text: string;
  /** False when the in-memory ring dropped older entries than `text` holds. */
  complete: boolean;
}

/** The plan widget, as the Settings panel sees it. The shell's `PlanWidgetStatePayload`. */
export interface DesktopPlanWidget {
  /** False where the shell cannot put a window on the desktop (not Windows). */
  supported: boolean;
  enabled: boolean;
}

/** One entry of the window's menu, as the page's menu bar draws it. */
export interface DesktopMenuItem {
  id: string;
  kind: "item" | "check" | "separator";
  label: string;
  /** The shortcut as the platform writes it (`Ctrl+Shift+I`), or null. */
  accelerator: string | null;
  enabled: boolean;
  checked?: boolean;
  /** Set when the entry only opens a route: the page navigates itself. */
  route?: string;
  /** A page action (`search`) the page runs itself. */
  command?: string;
}

export interface DesktopMenuGroup {
  label: string;
  items: DesktopMenuItem[];
}

/** One message to the pen's actuator: velocity in CSS px/ms, pressure in [0, 1]. */
export type DesktopInkHaptics =
  | { type: "tool"; tool: "pen" | "highlighter" | "eraser" }
  | { type: "update"; pressure: number; velocity: number }
  | { type: "stop" };

/** One page's lines for the recogniser: flat `[x, y, pressure, …]` per stroke. */
export interface DesktopInkRequest {
  lines: { strokes: number[][] }[];
  vocabulary?: string[];
  lang?: string;
}

export interface DesktopInkResult {
  engine: string;
  lines: {
    text: string;
    confidence: number;
    alternatives?: string[];
    /** Each word's readings and the OS dictionary's verdict on each; see `decodeInkWords`. */
    words?: {
      candidates: string[];
      known?: boolean[] | null;
      join?: string | null;
    }[];
  }[];
  ms: number;
}

/** One Overleaf checkout, flattened for the wire. */
export interface DesktopOverleafSource {
  projectId: string;
  entryFile: string;
  files: { path: string; content: string }[];
  overleafUrl: string;
}
