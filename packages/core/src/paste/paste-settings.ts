/**
 * What the paste pipeline is allowed to do, per user.
 *
 * Defaults are chosen so that a paste is never *surprising*: everything on by
 * default is a repair with no stylistic opinion — removing a tracker, removing
 * a character nobody can see, trimming the blank line a copy dragged along.
 * Anything that rewrites how a writer set their text (quotes, dashes) is off
 * until they ask for it, because a thesis that deliberately uses en dashes
 * should not have them silently taken away.
 */

export interface PasteSettings {
  /**
   * The master switch. Off means the automatic rules never run and the
   * on-demand cleanups still do.
   */
  cleanOnPaste: boolean;
  /** Strip tracking parameters and scroll-to-text fragments from links. */
  cleanLinks: boolean;
  /**
   * Extra removal rules, one per line:
   * `fbclid`, `site.example | a, b`, or `!youtube.com` to switch the built-in
   * rules off for a site.
   */
  linkRemovals: readonly string[];
  /** Drop zero-width characters and normalise exotic spaces. */
  normalizeInvisible: boolean;
  /** Remove blank lines and stray spaces around the paste. */
  trimWhitespace: boolean;
  /** Turn curly quotes and apostrophes into straight ones. */
  straightenQuotes: boolean;
  /** Turn en and em dashes into hyphens. */
  straightenDashes: boolean;
  /** Strip terminal escape sequences from every paste. */
  stripEscapeSequences: boolean;
  /**
   * Turn a tab-separated paste into a Markdown table.
   *
   * On by default, because tab-separated rows pasted into Markdown render as
   * one run-together line: this is a repair, not a preference. Tabs only —
   * comma-separated text is indistinguishable from prose.
   */
  tabsToTable: boolean;
  /**
   * Turn a bare DOI or arXiv id into a link to its resolver.
   *
   * On by default: both have exactly one canonical resolver, so this needs no
   * network and makes no guess, and a bare identifier in a note is dead text a
   * year later.
   */
  linkIdentifiers: boolean;
  /**
   * Run the PDF repair automatically on a paste that looks like it came from
   * one. Off by default: it is the most opinionated of the rules, and the
   * on-demand command has a preview.
   */
  cleanPdfOnPaste: boolean;
}

export const DEFAULT_PASTE_SETTINGS: PasteSettings = {
  cleanOnPaste: true,
  cleanLinks: true,
  linkRemovals: [],
  normalizeInvisible: true,
  trimWhitespace: true,
  straightenQuotes: false,
  straightenDashes: false,
  stripEscapeSequences: true,
  tabsToTable: true,
  linkIdentifiers: true,
  cleanPdfOnPaste: false,
};

/** A stored rule list this long is a mistake, not a preference. */
const MAX_LINK_REMOVALS = 200;
const MAX_LINK_REMOVAL_LENGTH = 200;

const BOOLEAN_KEYS = [
  "cleanOnPaste",
  "cleanLinks",
  "normalizeInvisible",
  "trimWhitespace",
  "straightenQuotes",
  "straightenDashes",
  "stripEscapeSequences",
  "tabsToTable",
  "linkIdentifiers",
  "cleanPdfOnPaste",
] as const satisfies readonly (keyof PasteSettings)[];

/**
 * Reads whatever was stored and returns settings the pipeline can trust.
 *
 * The stored value is user-writable, so anything unrecognised falls back to its
 * default rather than reaching the rules as free-form input.
 */
export function normalizePasteSettings(raw: unknown): PasteSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_PASTE_SETTINGS };
  const input = raw as Partial<Record<keyof PasteSettings, unknown>>;
  const out: PasteSettings = { ...DEFAULT_PASTE_SETTINGS };

  for (const key of BOOLEAN_KEYS) {
    if (typeof input[key] === "boolean") out[key] = input[key];
  }

  if (Array.isArray(input.linkRemovals)) {
    out.linkRemovals = input.linkRemovals
      .filter((line): line is string => typeof line === "string")
      .map((line) => line.trim().slice(0, MAX_LINK_REMOVAL_LENGTH))
      .filter((line) => line.length > 0)
      .slice(0, MAX_LINK_REMOVALS);
  }

  return out;
}

/** Splits a settings textarea into rule lines. */
export function parseLinkRemovalText(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
