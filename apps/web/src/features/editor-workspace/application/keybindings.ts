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
  | "previous-tab";

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
  if (key === "\\") return "split-right";
  if (key === "w") return "close-tab";
  if (key === "tab") return chord.shiftKey ? "previous-tab" : "next-tab";
  return null;
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
