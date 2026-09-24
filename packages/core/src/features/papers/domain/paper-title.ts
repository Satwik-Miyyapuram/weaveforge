/**
 * Paper titles that are not the paper's title.
 *
 * Two shapes reach the library in practice. A PDF saved by a reference manager
 * is named "Goyal et al. - 2017 - Accurate, Large Minibatch SGD.pdf", and when
 * the file is all an import has, that name becomes the title. And a page or an
 * attachment scraped for metadata is often titled by its site rather than its
 * content: "Catalog Page", "SAGE PDF Full Text", "ScienceDirect Full Text PDF".
 * The first can be read back into a title; the second names nothing and must
 * not be imported as one.
 */

/** Titles a publisher or reference manager gives a page or file, not a paper. */
const PLACEHOLDER_TITLES: readonly RegExp[] = [
  /^catalog(ue)? page$/i,
  /^(\w+ )*(full[ -]?text|pdf)( pdf| full[ -]?text)*$/i, // "SAGE PDF Full Text", "Full Text PDF", "ScienceDirect Full Text PDF"
  /^(preprint|accepted|submitted|published) (pdf|version)$/i,
  /^snapshot$/i,
  /^(untitled|document|download|view|pdf|article)$/i,
  /^(just a moment|access denied|attention required|page not found|404 not found|sign in|log ?in)\b/i,
];

/**
 * Whether a title is a placeholder rather than a paper's title.
 *
 * Deliberately narrow: a real paper may be called "Full Text Search at Scale",
 * so only a title made of nothing but these words counts.
 */
export function isPlaceholderTitle(title: string | null | undefined): boolean {
  const t = (title ?? "").trim().replace(/\s+/g, " ");
  if (!t) return true;
  return PLACEHOLDER_TITLES.some((pattern) => pattern.test(t));
}

/**
 * The title inside a reference-manager filename, or the input unchanged.
 *
 * "Goyal et al. - 2017 - Accurate, Large Minibatch SGD.pdf" becomes
 * "Accurate, Large Minibatch SGD". Zotero's default pattern is
 * `{author} - {year} - {title}`, and Mendeley's and JabRef's are alike; a
 * filesystem forbids ":" so the subtitle separator arrives as "_" or " - ",
 * which is put back as ": ". Anything that does not look like a filename —
 * no extension and no "author - year -" prefix — is returned as it was.
 */
export function titleFromFileName(title: string): string {
  const trimmed = title.trim();
  const withoutExt = trimmed.replace(/\.(pdf|html?|epub|djvu)$/i, "");
  const hadExt = withoutExt !== trimmed;
  const prefixed = /^(.{1,80}?) - (\d{4}|n\.d\.) - (.+)$/.exec(withoutExt);
  if (!prefixed && !hadExt) return title;
  let rest = (prefixed ? prefixed[3]! : withoutExt).trim();
  if (hadExt || prefixed) rest = rest.replace(/_ /g, ": ").replace(/\s+/g, " ");
  return rest || title;
}

/**
 * A title reduced to what identifies it: lower case, letters and digits only,
 * placeholder and filename noise removed. Null when too short to trust, since
 * "Notes" or "Introduction" names many things.
 */
export function titleKey(title: string | null | undefined): string | null {
  if (!title || isPlaceholderTitle(title)) return null;
  const key = titleFromFileName(title)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return key.replace(/ /g, "").length >= 20 ? key : null;
}
