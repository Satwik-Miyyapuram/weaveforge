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
  | "toggle-focus"
  | "show-shortcuts"
  | "reopen-tab"
  | TabNumberCommand;

/** `⌘1`–`⌘8` pick a tab by position and `⌘9` the last one, as a browser does. */
export type TabNumberCommand = `tab-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}` | "last-tab";

export interface KeyChord {
  key: string;
  /** The physical key. Digits are read from here, since AZERTY types them as symbols. */
  code?: string;
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
 *
 * `tabCount` is how many tabs the focused pane has. A tab-number chord with no
 * tab behind it is not claimed, so the browser keeps it (its own tab switch).
 */
export function commandForChord(chord: KeyChord, tabCount = Number.POSITIVE_INFINITY): WorkspaceCommand | null {
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
  // `⌘/` is read by physical key: on many layouts `/` needs Shift and types `?`.
  if (key === "/" || chord.code === "Slash") return "show-shortcuts";
  // `⌘⇧T` is a browser's "reopen closed tab"; plain `⌘T` stays its "new tab".
  if (key === "t" && chord.shiftKey) return "reopen-tab";
  if (key === "\\") return "split-right";
  if (key === "w") return "close-tab";
  if (key === "tab") return chord.shiftKey ? "previous-tab" : "next-tab";
  // `⌘0` stays the host's "reset zoom"; a shifted digit is a symbol.
  const digit = digitOf(chord);
  if (digit === null || chord.shiftKey) return null;
  if (digit === 9) return tabCount >= 1 ? "last-tab" : null;
  if (digit > tabCount) return null;
  return `tab-${digit}` as TabNumberCommand;
}

/** The digit 1–9 a chord names by its physical key, else by its character. */
function digitOf(chord: KeyChord): number | null {
  const fromCode = /^Digit([1-9])$/.exec(chord.code ?? "");
  const digit = fromCode ? fromCode[1] : /^[1-9]$/.test(chord.key) ? chord.key : null;
  return digit === null ? null : Number(digit);
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
  "show-shortcuts": "⌘/",
  "reopen-tab": "⌘⇧T",
  "split-right": "⌘\\",
  "close-tab": "⌘W",
  "next-tab": "⌘⇥",
  "previous-tab": "⌘⇧⇥",
  "tab-1": "⌘1",
  "tab-2": "⌘2",
  "tab-3": "⌘3",
  "tab-4": "⌘4",
  "tab-5": "⌘5",
  "tab-6": "⌘6",
  "tab-7": "⌘7",
  "tab-8": "⌘8",
  "last-tab": "⌘9",
};

export function shortcutTable(): Record<WorkspaceCommand, string> {
  return { ...CHORDS };
}

/**
 * Whether a shortcut should be ignored because the user is typing.
 *
 * The editor itself is an exception: CodeMirror is a text surface, but the
 * whole point of `Ctrl-W` in an editor shell is closing the document you are
 * editing, so only genuine form fields swallow the chord. That is why this
 * is not `isEditableTarget` (lib/editable-target), which counts
 * contenteditable as owning its keys.
 */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return false;
  const tag = (target.tagName ?? "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}
