/**
 * Tokenization shared by indexing and querying. Pure and dependency-free, so
 * the rules are testable without a search engine and identical on both sides —
 * a term tokenized one way at index time and another at query time simply
 * never matches.
 */

/** Combining marks left behind by NFD normalization. */
const COMBINING_MARKS = /[̀-ͯ]/g;
/** Arabic harakat. Separate because stripping them is not always wanted. */
const ARABIC_DIACRITICS = /[ً-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/g;

export interface TokenizerOptions {
  /** Fold é→e, ü→u. On by default. */
  foldDiacritics?: boolean;
  /** Additionally strip Arabic harakat. */
  foldArabicDiacritics?: boolean;
  /** Emit `my`+`variable` alongside `myVariable`. On by default. */
  splitCamelCase?: boolean;
  /** Emit host and path segments of a URL as separate terms. On by default. */
  tokenizeUrls?: boolean;
}

export function foldDiacritics(value: string, includeArabic = false): string {
  const folded = value.normalize("NFD").replace(COMBINING_MARKS, "");
  const result = includeArabic ? folded.replace(ARABIC_DIACRITICS, "") : folded;
  return result.normalize("NFC");
}

/** CJK ranges: Han, Hiragana, Katakana, Hangul. */
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/;

export function isCjk(char: string): boolean {
  return CJK_RE.test(char);
}

/**
 * CJK has no spaces, so whitespace splitting yields one enormous token. Emit
 * every character plus every adjacent bigram: unigrams make single-character
 * queries work, bigrams carry most of the meaning in Chinese and Japanese.
 */
function cjkTokens(run: string): string[] {
  const out: string[] = [...run];
  for (let i = 0; i < run.length - 1; i += 1) out.push(run.slice(i, i + 2));
  return out;
}

/** `parseHTTPResponse` → `parse`, `http`, `response`. */
function camelCaseParts(token: string): string[] {
  if (!/[a-z]/.test(token) || !/[A-Z]/.test(token)) return [];
  return token
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(" ")
    .filter((part) => part.length > 1)
    .map((part) => part.toLowerCase());
}

const URL_RE = /https?:\/\/\S+|\S+\.(?:com|org|net|edu|io|ai|dev|gov)\b\S*/gi;

/** `https://arxiv.org/abs/2305.12345` → arxiv, org, abs, 2305, 12345. */
function urlParts(text: string): string[] {
  const out: string[] = [];
  for (const match of text.match(URL_RE) ?? []) {
    for (const part of match.split(/[^\p{L}\p{N}]+/u)) {
      if (part.length > 1) out.push(part.toLowerCase());
    }
  }
  return out;
}

/**
 * Split text into search terms. Latin-ish runs split on non-alphanumerics; CJK
 * runs are handled separately; camelCase and URL parts are emitted in addition
 * to the original token, never instead of it.
 */
export function tokenize(text: string, options: TokenizerOptions = {}): string[] {
  if (!text) return [];
  const {
    foldDiacritics: fold = true,
    foldArabicDiacritics = false,
    splitCamelCase = true,
    tokenizeUrls = true,
  } = options;

  const extras: string[] = [];
  if (tokenizeUrls) extras.push(...urlParts(text));

  const out = new Set<string>(extras);

  // Split on anything that is neither letter nor number, keeping CJK runs whole
  // for the dedicated pass below.
  for (const raw of text.split(/[^\p{L}\p{N}_]+/u)) {
    if (!raw) continue;
    if (splitCamelCase) for (const part of camelCaseParts(raw)) out.add(part);

    const normalized = fold ? foldDiacritics(raw, foldArabicDiacritics) : raw;
    const lower = normalized.toLowerCase();

    // A token may mix scripts ("VAE編碼器"). Accumulate same-script runs and
    // flush on each transition, so a CJK run reaches `cjkTokens` whole and
    // actually yields bigrams.
    let buffer = "";
    let bufferIsCjk = false;
    const flush = () => {
      if (!buffer) return;
      if (bufferIsCjk) for (const token of cjkTokens(buffer)) out.add(token);
      else out.add(buffer);
      buffer = "";
    };

    for (const char of lower) {
      const charIsCjk = isCjk(char);
      if (buffer && charIsCjk !== bufferIsCjk) flush();
      bufferIsCjk = charIsCjk;
      buffer += char;
    }
    flush();
  }

  return [...out].filter(Boolean);
}

/** Normalization applied to a single term on both index and query sides. */
export function processTerm(term: string, options: TokenizerOptions = {}): string {
  const { foldDiacritics: fold = true, foldArabicDiacritics = false } = options;
  const normalized = fold ? foldDiacritics(term, foldArabicDiacritics) : term;
  return normalized.toLowerCase();
}
