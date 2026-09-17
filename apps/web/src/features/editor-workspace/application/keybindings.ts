/**
 * Workspace shortcuts, as a lookup rather than a pile of `if`s in the screen.
 *
 * Kept pure so the awkward cases are testable: a shortcut must not fire while
 * the user is typing into the quick-open box, `Ctrl-W` has to be claimed before
 * the host window reads it as "close tab", and Cmd is the modifier on macOS
 * where Ctrl is not.
 */

export type WorkspaceCommand =
  | "quick-open"
  | "split-right"
  | "close-tab"
  | "next-tab"
  | "previous-tab"
  | "toggle-mode"
  | "new-note"
  | "toggle-explorer"
  | "toggle-focus";

export interface KeyChord {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * The command a chord means, or `null`.
 *
 * `Ctrl` and `Cmd` are interchangeable rather than platform-detected: a mac
 * keyboard sends Cmd, an external PC keyboard on the same machine sends Ctrl,
 * and both mean "the modifier" to the person pressing it.
 */
export function commandForChord(chord: KeyChord): WorkspaceCommand | null {
  const mod = Boolean(chord.ctrlKey || chord.metaKey);
  if (!mod || chord.altKey) return null;

  const key = chord.key.toLowerCase();
  if (key === "p" && !chord.shiftKey) return "quick-open";
  if (key === "e" && !chord.shiftKey) return "toggle-mode";
  // `Ctrl-N` is "new window" to a browser; the workspace claims it the way an
  // editor does, and Electron does not give the browser's meaning a chance.
  if (key === "n" && !chord.shiftKey) return "new-note";
  // `⌘B` is VS Code's "toggle side bar"; the explorer is the side bar here.
  if (key === "b" && !chord.shiftKey) return "toggle-explorer";
  // `⌘⇧F`: the document alone — no rail, no explorer, no strip, no status
  // bar. For a hand on a pen the chrome is inches of page it cannot write on.
  if (key === "f" && chord.shiftKey) return "toggle-focus";
  if (key === "\\") return "split-right";
  if (key === "w") return "close-tab";
  if (key === "tab") return chord.shiftKey ? "previous-tab" : "next-tab";
  return null;
}

/**
 * The chord a command is on, as it should be printed in the UI.
 *
 * The empty state's shortcut grid and any tooltip read *this*, not a string
 * typed into JSX, so a label cannot claim a chord `commandForChord` does not
 * accept — and changing a binding here changes every place it is shown.
 *
 * One chord per command, and the modifier is written once: `⌘P`, not `Ctrl+P
 * or ⌘P`. The editor already treats the two as the same key, so printing both
 * would be noise; `⌘` is the shorter of the two spellings.
 */
const CHORDS: Record<WorkspaceCommand, string> = {
  "quick-open": "⌘P",
  "toggle-mode": "⌘E",
  "new-note": "⌘N",
  "toggle-explorer": "⌘B",
  "toggle-focus": "⌘⇧F",
  "split-right": "⌘\\",
  "close-tab": "⌘W",
  "next-tab": "⌘⇥",
  "previous-tab": "⌘⇧⇥",
};

export function shortcutTable(): Record<WorkspaceCommand, string> {
  return { ...CHORDS };
}

export function chordFor(command: WorkspaceCommand): string {
  return CHORDS[command];
}

/**
 * Whether a shortcut should be ignored because the user is typing.
 *
 * The editor itself is an exception: CodeMirror is a text surface, but the
 * whole point of `Ctrl-W` in an editor shell is closing the document you are
 * editing, so only genuine form fields swallow the chord.
 */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return false;
  const tag = (target.tagName ?? "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}
