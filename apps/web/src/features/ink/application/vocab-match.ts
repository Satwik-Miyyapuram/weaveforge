/**
 * The post-match: recognised text against words the workspace already knows.
 *
 * A handwriting engine has never seen "Graph-prior module" or `smith2021`, and
 * writes them as whatever they look like. Windows Ink takes a word list as a
 * guide (§5.4) but the web engine and MyScript do not, so this is the pass that
 * runs after any of them: each vocabulary entry — a note title, a paper title, a
 * citation key — is slid over the recognised words, and a near-miss is rewritten
 * to the exact entry. Near is Damerau–Levenshtein ≤ 2 per word and ≤ 25 % of the
 * entry's length in total, which is loose enough for a dropped stroke and tight
 * enough that "model" does not become "module".
 *
 * `[[…]]` spans are matched first and on their own: a wikilink that resolves is
 * a backlink, and one that is off by a letter is a dangling one, so the inside
 * of the brackets is where a correction is worth the most.
 *
 * The symbol map is the small reversible list §5.4 asks for and nothing more —
 * no maths → LaTeX here.
 */

export interface VocabMatch {
  /** The words as the engine wrote them. */
  from: string;
  /** The vocabulary entry they were rewritten to. */
  to: string;
}

export interface VocabMatchResult {
  text: string;
  matches: VocabMatch[];
}

/** The arrows and comparisons a researcher writes, mapped once (§5.4). */
export const INK_SYMBOL_MAP: readonly (readonly [string, string])[] = [
  ["->", "→"],
  ["<-", "←"],
  ["<=", "≤"],
  [">=", "≥"],
  ["!=", "≠"],
  ["=>", "⇒"],
];

/** How far a single word may be from an entry's word. */
export const VOCAB_WORD_DISTANCE = 2;
/** How far the whole span may be, as a share of the entry's length. */
export const VOCAB_SPAN_RATIO = 0.25;

/**
 * Damerau–Levenshtein with adjacent transpositions (the restricted form), which
 * is the edit an engine most often makes: two letters whose strokes overlapped.
 */
export function damerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let previous2: number[] = [];
  let previous = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const current = [i];
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, previous2[j - 2]! + 1);
      }
      current[j] = value;
    }
    previous2 = previous;
    previous = current;
  }
  return previous[n]!;
}

const fold = (word: string): string =>
  word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * The distance between a run of recognised words and an entry, or `Infinity`
 * when any word is further than {@link VOCAB_WORD_DISTANCE} or the total is
 * over {@link VOCAB_SPAN_RATIO} of the entry.
 */
export function spanDistance(
  words: readonly string[],
  entryWords: readonly string[],
): number {
  if (words.length !== entryWords.length || words.length === 0) return Infinity;
  let total = 0;
  let length = 0;
  for (let i = 0; i < words.length; i += 1) {
    const a = fold(words[i]!);
    const b = fold(entryWords[i]!);
    const distance = damerauLevenshtein(a, b);
    if (distance > VOCAB_WORD_DISTANCE) return Infinity;
    total += distance;
    length += b.length;
  }
  return total <= Math.floor(length * VOCAB_SPAN_RATIO) ? total : Infinity;
}

/** Rewrite one span of words to the closest entry, if one is close enough. */
function matchSpan(
  span: string,
  vocabulary: readonly string[],
  matches: VocabMatch[],
): string {
  const words = span.split(/\s+/).filter(Boolean);
  if (words.length === 0) return span;
  const trimmed = words.join(" ");
  let best: { entry: string; distance: number } | null = null;
  for (const entry of vocabulary) {
    const entryWords = entry.split(/\s+/).filter(Boolean);
    const distance = spanDistance(words, entryWords);
    if (distance === Infinity) continue;
    if (!best || distance < best.distance) best = { entry, distance };
  }
  if (!best || fold(best.entry) === fold(trimmed)) return span;
  matches.push({ from: trimmed, to: best.entry });
  return best.entry;
}

/**
 * Rewrite the near-misses in one line, and the symbols.
 *
 * Wikilinks first, whole; then every window of the line's remaining words the
 * length of some entry, longest entries first so "Graph-prior module" wins over
 * a one-word "module". A window that matched is skipped over, not re-matched.
 */
export function matchVocabulary(
  text: string,
  vocabulary: readonly string[],
): VocabMatchResult {
  const matches: VocabMatch[] = [];
  const entries = vocabulary.map((entry) => entry.trim()).filter(Boolean);

  let out = text.replace(/\[\[([^\]]+)\]\]/g, (_whole, inner: string) => {
    const [target, alias] = inner.split("|");
    const fixed = matchSpan(target!.trim(), entries, matches);
    return `[[${alias === undefined ? fixed : `${fixed}|${alias}`}]]`;
  });

  // Outside the links: the plain words, with the links masked so they are neither
  // matched twice nor split by the window.
  const parts = out.split(/(\[\[[^\]]+\]\])/g);
  const lengths = [
    ...new Set(entries.map((entry) => entry.split(/\s+/).length)),
  ].sort((a, b) => b - a);
  out = parts
    .map((part) => {
      if (part.startsWith("[[")) return part;
      const tokens = part.split(/(\s+)/);
      // Tokens alternate word, space, word…; walk the words with windows of each length.
      const wordAt = (index: number) => tokens[index * 2] ?? "";
      const wordCount = () => Math.ceil(tokens.length / 2);
      for (const length of lengths) {
        let i = 0;
        while (i + length <= wordCount()) {
          const window = Array.from({ length }, (_, k) => wordAt(i + k));
          if (window.some((word) => word === "")) {
            i += 1;
            continue;
          }
          const before = matches.length;
          const replaced = matchSpan(window.join(" "), entries, matches);
          if (matches.length > before) {
            // Splice the entry back in as one token, keeping the punctuation
            // the last word carried.
            const trailing =
              /[^\p{L}\p{N}]*$/u.exec(window[length - 1]!)?.[0] ?? "";
            const leading = /^[^\p{L}\p{N}]*/u.exec(window[0]!)?.[0] ?? "";
            tokens.splice(i * 2, length * 2 - 1, leading + replaced + trailing);
            i += 1;
            continue;
          }
          i += 1;
        }
      }
      return tokens.join("");
    })
    .join("");

  for (const [from, to] of INK_SYMBOL_MAP)
    out = out.split(` ${from} `).join(` ${to} `);
  return { text: out, matches };
}
