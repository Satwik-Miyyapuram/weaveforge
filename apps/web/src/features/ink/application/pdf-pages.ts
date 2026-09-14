/**
 * Which pages of a PDF the user meant: the answer to "all pages or which?".
 *
 * The prompt that asked this used to take one number, which made a 40-page
 * paper 40 rounds of insert-one-page. The answer is now a list — `all`, or a
 * comma-separated set of numbers and `from-to` ranges — parsed here so the
 * dialog, the insert flow and a test all agree about what "1,3-5" means.
 *
 * Pure string work, deliberately forgiving in the ways a human is: spaces are
 * free, `1 - 3` is `1-3`, an empty answer is "no pages" rather than an error,
 * and duplicates collapse (they name the same page twice, and the page is
 * imported once). The bounds are the caller's to enforce: this returns the
 * numbers as written, sorted, and the dialog validates against the count.
 */
export interface PageSelection {
  /** Every page named, 1-based, sorted, deduplicated. */
  pages: number[];
}

/** Parse `all` (any case, alone) as "every page", needing only the count. */
export function isAllPages(answer: string): boolean {
  return /^\s*all\s*$/i.test(answer);
}

/**
 * Parse a page list: `1`, `1,3`, `1,3-5`, `2-`, with spaces anywhere a human
 * puts them. A trailing or leading dash means "to the end" / "from the start"
 * only when the other side is there; a bare dash is nothing.
 */
export function parsePageList(answer: string): PageSelection {
  const pages = new Set<number>();
  for (const part of answer.split(",")) {
    const range = part.trim();
    if (range === "") continue;
    const match = /^(\d*)\s*-\s*(\d*)$/.exec(range);
    if (match) {
      // A bare dash names nothing: neither side is there, so there is no page
      // to start from and none to end at. One side alone carries the default.
      if (match[1] === "" && match[2] === "") continue;
      const from = match[1] === "" ? 1 : Number(match[1]);
      const to = match[2] === "" ? from : Number(match[2]);
      // A reversed range is read the way it was probably meant, not as a
      // surprise empty set: "5-3" names three pages either way round.
      const low = Math.min(from, to);
      const high = Math.max(from, to);
      for (let page = low; page <= high; page += 1) pages.add(page);
      continue;
    }
    const single = Number(range);
    if (Number.isFinite(single) && single > 0) pages.add(single);
  }
  return { pages: [...pages].sort((a, b) => a - b) };
}

/**
 * The whole answer, bounds applied: `all` with the count, or the parsed list
 * filtered to the pages the document has. `[]` is the caller's "do nothing".
 */
export function selectedPdfPages(answer: string, count: number): number[] {
  if (isAllPages(answer)) {
    return Array.from({ length: count }, (_, index) => index + 1);
  }
  return parsePageList(answer).pages.filter((page) => page >= 1 && page <= count);
}

/** What the dialog's validation line says about an answer, or `null` if good. */
export function pageListProblem(
  answer: string,
  count: number,
): string | null {
  if (isAllPages(answer)) return null;
  const parsed = parsePageList(answer).pages;
  if (parsed.length === 0) {
    return count > 1
      ? `Enter a page, a list like 1,3-5, or "all".`
      : "Enter the page to use.";
  }
  const outOfRange = parsed.find((page) => page < 1 || page > count);
  if (outOfRange !== undefined) {
    return `Page ${outOfRange} is outside this PDF, which has ${count}.`;
  }
  return null;
}
