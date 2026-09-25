/**
 * Choosing among an engine's readings of each word, and saying how sure the
 * choice is.
 *
 * Windows Ink returns, per word, the reading it prefers and the others it
 * considered — "brown", "lorown", "bown" — and no score for any of them. The
 * desktop helper adds one fact per reading from the OS spell checker: is this a
 * word. That is enough to do three things the raw text could not:
 *
 * 1. **Prefer a reading the workspace knows.** A note is full of terms no
 *    general recogniser has seen — "softmax", "Graph-prior", `smith2021` — and
 *    when one of them is among a word's readings it beats the engine's pick,
 *    unless the pick is a dictionary word and the term is too. The vocabulary is
 *    the one `inkVocabularyHints` builds, so the terms are the workspace's own.
 * 2. **Prefer a word over a non-word.** When the engine's pick is not in the
 *    dictionary and one of its own alternatives is, the alternative wins. Every
 *    alternative is a reading the engine found visually plausible, so this is a
 *    choice among its readings, never a spelling correction from nowhere.
 * 3. **Mend the spacing.** Most of what a recogniser gets wrong in running
 *    handwriting is where words start and end — "seedsmatters", "dr aft". For a
 *    word none of whose readings is a word, the helper adds the two-word
 *    readings whose halves both are; for two neighbours whose joined reading is
 *    a word, it says so (`join`). The split competes as one more reading; the
 *    join is taken only when one of the two words is in doubt, and offered as
 *    an alternative otherwise, because "a part" and "apart" are both English.
 * 4. **Measure the line.** A word that ends up neither known nor a dictionary
 *    word is unsure, and one is enough to put the line under
 *    {@link INK_UNSURE_CONFIDENCE} — which is what finally lets the text layer's
 *    dotted underline point at a line worth checking. The alternatives offered
 *    for correction are whole lines with one doubtful word swapped, rather than
 *    one word's readings shown as if they were lines.
 *
 * Pure: no engine, no dictionary, no I/O. The verdicts arrive with the readings.
 */

import { INK_UNSURE_CONFIDENCE, type RecognisedLine } from "./recognise.js";

/** One word as the engine read it: readings best-first, and the dictionary's verdict on each. */
export interface InkWordReadings {
  candidates: readonly string[];
  /** Parallel to `candidates`; absent or null when the machine had no dictionary for the language. */
  known?: readonly boolean[] | null;
  /** This word and the next read as one, when the dictionary knows the joined reading. */
  join?: string | null;
}

/**
 * The most an engine's line may score. `1` is reserved: it marks a line a
 * person corrected, which `recognisePage` keeps through the next run rather
 * than recognising again, so an engine that reported `1` would freeze its own
 * guesses.
 */
export const INK_ENGINE_MAX_CONFIDENCE = 0.95;

/** How much each unsure word costs a line, as a share of its words. */
const UNSURE_PENALTY = 0.5;

/** The most a line with any unsure word may score: under the underline threshold. */
const UNSURE_LINE_MAX = INK_UNSURE_CONFIDENCE - 0.05;

/** Line alternatives offered for correction. */
const MAX_LINE_ALTERNATIVES = 4;

const fold = (word: string): string => word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

const hasLetters = (word: string): boolean => /\p{L}/u.test(word);

/** Edit distance, stopping early once it passes `limit`. */
function distanceWithin(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      row[j] = Math.min(cost, previous[j]! + 1, row[j - 1]! + 1);
      best = Math.min(best, row[j]!);
    }
    if (best > limit) return false;
    previous = row;
  }
  return previous[b.length]! <= limit;
}

/**
 * Whether a misread is close enough to a workspace term that the title
 * post-match (`matchVocabulary`) will mend it — "alolation" for "ablation".
 * Cutting such a word in two would hand that pass two wrong words instead.
 */
function nearVocabulary(word: string, vocabulary: Set<string>): boolean {
  const folded = fold(word);
  if (folded.length < 5) return false;
  const limit = Math.max(1, Math.floor(folded.length / 4));
  for (const term of vocabulary) {
    if (term.length >= 5 && distanceWithin(folded, term, limit)) return true;
  }
  return false;
}

/**
 * A reading with a hyphen or slash the engine's pick does not have —
 * "seeds-matters" for "seedsmatters" — is two words the engine ran together;
 * the dictionary accepts it as a compound, but the writer left a space.
 */
function unjoined(reading: string, top: string): string {
  if (/[-/]/.test(top) || !/^[\p{L}]+[-/][\p{L}]+$/u.test(reading) ) return reading;
  return reading.replace(/[-/]/, " ");
}

/** Every word of every vocabulary entry, folded — hyphenated terms both whole and in parts. */
export function inkVocabularyWords(vocabulary: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const entry of vocabulary) {
    for (const token of entry.split(/\s+/)) {
      const whole = fold(token);
      if (whole.length >= 2) out.add(whole);
      for (const part of token.split(/[-_/]/)) {
        const folded = fold(part);
        if (folded.length >= 3) out.add(folded);
      }
    }
  }
  return out;
}

interface Chosen {
  text: string;
  sure: boolean;
  /** The engine's own pick was a non-word, even if another reading was kept. */
  doubted?: boolean;
  /** The other readings worth offering, best first. */
  others: string[];
}

/**
 * The reading to keep for one word.
 *
 * A reading much shorter than the engine's pick is not considered — "s" is a
 * dictionary word and a plausible reading of the tail of "is", and choosing it
 * would trade a doubtful word for a wrong one.
 */
function chooseReading(word: InkWordReadings, vocabulary: Set<string>): Chosen | null {
  const candidates = word.candidates.filter((c) => c.trim().length > 0);
  const top = candidates[0];
  if (top === undefined) return null;
  const known = word.known?.length === word.candidates.length ? word.known : undefined;
  const isKnown = (candidate: string): boolean | undefined =>
    known ? known[word.candidates.indexOf(candidate)] : undefined;
  const minLength = Math.min(3, fold(top).length);
  // A two-word reading is the helper's split of a non-word; it is held back
  // when the non-word looks like a workspace term, for the reason above.
  const splitsAllowed = !nearVocabulary(top, vocabulary);
  const eligible = candidates.filter(
    (c) => fold(c).length >= minLength && (splitsAllowed || !c.includes(" ")),
  );

  // A title's ordinary words are vocabulary too — "Attention Is All You Need"
  // brings "is" and "all" — so a vocabulary reading only displaces a pick the
  // dictionary accepts when the reading is itself no dictionary word: a term.
  // With no dictionary at all, only a longer reading may, for the same reason.
  const displaces = (c: string): boolean =>
    c === top ||
    (known ? isKnown(top) !== true || isKnown(c) === false : fold(c).length >= 5);
  const inVocabulary = eligible.find((c) => vocabulary.has(fold(c)) && displaces(c));
  let text: string;
  let sure: boolean;
  if (inVocabulary !== undefined) {
    text = inVocabulary;
    sure = true;
  } else if (!hasLetters(top) || isKnown(top) !== false) {
    // Numbers and marks are not the dictionary's to judge, and a reading with no
    // verdict is not evidence against the engine.
    text = top;
    sure = true;
  } else {
    const word = eligible.find((c) => isKnown(c) === true);
    text = word === undefined ? top : unjoined(word, top);
    sure = word !== undefined;
  }
  const others = candidates
    .filter((c) => c !== text && fold(c) !== fold(text) && fold(c).length >= minLength)
    .sort((a, b) => Number(isKnown(b) === true) - Number(isKnown(a) === true));
  return { text, sure, others, doubted: hasLetters(top) && isKnown(top) === false };
}

/**
 * One line from its words' readings: the chosen text, a confidence under
 * {@link INK_ENGINE_MAX_CONFIDENCE}, and whole-line alternatives.
 *
 * `engineText` is what the engine itself said for the line; when the choice
 * above changed a word, it is offered back first, so a wrong preference is one
 * click to undo.
 */
export function decodeInkWords(
  words: readonly InkWordReadings[],
  vocabulary: readonly string[],
  engineText?: string,
): RecognisedLine {
  const known = inkVocabularyWords(vocabulary);
  const read = words
    .map((word) => ({ word, choice: chooseReading(word, known) }))
    .filter((r): r is { word: InkWordReadings; choice: Chosen } => r.choice !== null);
  if (read.length === 0) return { text: engineText?.trim() ?? "", conf: 0 };

  // Joins: taken where either half is in doubt — including a non-word the
  // engine picked and a case variant rescued, "dr" → "Dr" — or the joined word
  // is a known term, and otherwise kept as a line to offer.
  const chosen: Chosen[] = [];
  const joinOffers: { at: number; text: string }[] = [];
  for (let index = 0; index < read.length; index++) {
    const { word, choice } = read[index]!;
    const next = read[index + 1];
    const join = word.join?.trim();
    if (join && next) {
      const doubt = (c: Chosen) => !c.sure || c.doubted === true;
      if (doubt(choice) || doubt(next.choice) || known.has(fold(join))) {
        chosen.push({ text: join, sure: true, others: [`${choice.text} ${next.choice.text}`] });
        index++;
        continue;
      }
      joinOffers.push({ at: chosen.length, text: join });
    }
    chosen.push(choice);
  }

  const text = chosen.map((c) => c.text).join(" ");
  const unsure = chosen.filter((c) => !c.sure).length;
  const conf =
    unsure === 0
      ? INK_ENGINE_MAX_CONFIDENCE
      : Math.max(0, Math.min(UNSURE_LINE_MAX, INK_ENGINE_MAX_CONFIDENCE - (UNSURE_PENALTY * unsure) / chosen.length));

  const alternatives: string[] = [];
  const offer = (line: string) => {
    if (line && line !== text && !alternatives.includes(line)) alternatives.push(line);
  };
  if (engineText !== undefined) offer(engineText.trim());
  for (const { at, text: join } of joinOffers) {
    offer(chosen.map((w, i) => (i === at ? join : i === at + 1 ? null : w.text)).filter((w) => w !== null).join(" "));
  }
  // Doubtful words first, then left to right: the swap most likely to be the fix.
  const order = chosen
    .map((c, index) => ({ c, index }))
    .sort((a, b) => Number(a.c.sure) - Number(b.c.sure) || a.index - b.index);
  for (let round = 0; round < 2 && alternatives.length < MAX_LINE_ALTERNATIVES; round++) {
    for (const { c, index } of order) {
      const other = c.others[round];
      if (other === undefined) continue;
      offer(chosen.map((w, i) => (i === index ? other : w.text)).join(" "));
      if (alternatives.length >= MAX_LINE_ALTERNATIVES) break;
    }
  }
  return { text, conf, ...(alternatives.length ? { alternatives } : {}) };
}
