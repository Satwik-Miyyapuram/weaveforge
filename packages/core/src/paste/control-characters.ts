/**
 * Escape sequences and control characters that survive a copy out of a
 * terminal.
 *
 * Every pattern is built from escape strings rather than literal control bytes,
 * so this file stays plain ASCII and survives being opened, diffed and pasted
 * around like any other source file.
 */

const ESC = "\\u001B";
const BEL = "\\u0007";

/**
 * DCS, SOS, PM and APC strings — sixel images, tmux passthrough, kitty
 * graphics. They run to a string terminator and carry an arbitrary payload, so
 * they have to be removed before anything else looks for a shorter sequence
 * inside that payload.
 */
const STRING_SEQUENCE = new RegExp(`${ESC}[PX^_](?:[^${ESC}]|${ESC}(?!\\\\))*${ESC}\\\\`, "g");

/** OSC sequences — window titles and hyperlinks — closed by BEL or ST. */
const OSC_SEQUENCE = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "g");

/** CSI sequences: colour, cursor movement, erase. The common case. */
const CSI_SEQUENCE = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");

/**
 * Everything else ECMA-48 allows: optional intermediate bytes then one final
 * byte. Covers charset selection, keypad modes, cursor save/restore, and a
 * bare trailing escape left by a truncated copy.
 */
const SIMPLE_SEQUENCE = new RegExp(`${ESC}[ -/]*[0-~]?`, "g");

/**
 * Control characters with no meaning in a note. Tab and newline are kept
 * because they carry layout; carriage return is handled by the callers, which
 * normalise line endings before they get here.
 */
const CONTROL_CHARACTER = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "g");

/** True when the text carries anything only a terminal would have written. */
export function hasControlSequences(text: string): boolean {
  return stripControlSequences(text) !== text;
}

/** Removes ANSI escape sequences and stray control characters. */
export function stripControlSequences(text: string): string {
  return text
    .replace(STRING_SEQUENCE, "")
    .replace(OSC_SEQUENCE, "")
    .replace(CSI_SEQUENCE, "")
    .replace(SIMPLE_SEQUENCE, "")
    .replace(CONTROL_CHARACTER, "");
}
