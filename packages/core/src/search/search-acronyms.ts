/**
 * Initialisms derived from a title, so "GAN" finds "Generative Adversarial
 * Networks".
 *
 * This is not typo tolerance and no amount of fuzziness reaches it: "gan" is
 * three characters and "generative" is ten, so they are nowhere near each other
 * by edit distance. Yet it is how people actually refer to papers — nobody types
 * "Denoising Diffusion Probabilistic Models" when DDPM will do.
 *
 * Derived at index time and stored in `aliases`, which is already a searchable,
 * boosted field, so this costs one small string per document and no schema
 * change.
 */

/**
 * Words that are part of a title's grammar rather than its subject. Skipped
 * when forming initials: readers say "GAN", not "GAAN", for *Generative
 * Adversarial* **and** *Networks*.
 */
const SKIP_WORDS = new Set([
  "a", "an", "the", "of", "for", "and", "or", "with", "without", "in", "on",
  "at", "to", "from", "by", "as", "is", "are", "be", "via", "using", "toward",
  "towards", "into", "over", "under", "between", "across", "you", "your",
  "its", "it", "we", "our",
]);

/** Below this an "acronym" is too short to be a useful or unambiguous handle. */
const MIN_ACRONYM_LENGTH = 3;
/** Fewer significant words than this cannot form a handle worth indexing. */
const MIN_ACRONYM_WORDS = 3;
/** Above this nobody is typing it as a shorthand. */
const MAX_ACRONYM_LENGTH = 8;

/**
 * Split a title into the words an initialism would be built from.
 *
 * Stops at the first `:` or `—` when there is text before it: paper titles are
 * overwhelmingly "SHORTNAME: the long descriptive part", and the initials of
 * the descriptive half are not what anyone types.
 */
function significantWords(title: string): string[] {
  const head = /^(.{2,60}?)\s*[:—–]\s+\S/.exec(title)?.[1] ?? title;
  return head
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .filter((word) => !SKIP_WORDS.has(word.toLowerCase()));
}

/**
 * Acronyms worth indexing for a title. Usually one; empty for titles that are
 * already short or that would produce something meaningless.
 */
export function acronymsForTitle(title: string): string[] {
  if (!title) return [];
  const out = new Set<string>();

  // A title that already *contains* a capitalised initialism — "β-VAE",
  // "BERT", "DDPM" — is findable by it. Scanned across the whole title and
  // independently of the word-count rule below, because these are usually one
  // word and would never survive it.
  for (const token of title.split(/[^\p{L}\p{N}]+/u)) {
    if (
      token.length >= MIN_ACRONYM_LENGTH &&
      token.length <= MAX_ACRONYM_LENGTH &&
      /^[\p{Lu}\p{N}]+$/u.test(token)
    ) {
      out.add(token.toLowerCase());
    }
  }

  // Initials of the significant words. Needs at least three of them: two words
  // cannot make a handle anyone would type, and the resulting two-letter string
  // would match a great deal of noise.
  const words = significantWords(title);
  if (words.length >= MIN_ACRONYM_WORDS) {
    const initials = words.map((word) => word[0]!).join("").toLowerCase();
    if (initials.length >= MIN_ACRONYM_LENGTH && initials.length <= MAX_ACRONYM_LENGTH) {
      out.add(initials);
    }

    // Long titles also get the initials of their first few words, because that
    // is the part people remember: "Deep Residual Learning for Image
    // Recognition" is searched as "drli" at least as often as in full.
    if (words.length > 4) {
      const leading = words.slice(0, 4).map((word) => word[0]!).join("").toLowerCase();
      if (leading.length >= MIN_ACRONYM_LENGTH) out.add(leading);
    }
  }

  return [...out];
}
