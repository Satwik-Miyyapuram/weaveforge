/** Token-set Dice similarity, insensitive to punctuation, accents and word order. */
export function titleSimilarity(left: string, right: string): number {
  const tokens = (text: string) => new Set(text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const common = [...a].filter((token) => b.has(token)).length;
  return 2 * common / (a.size + b.size);
}

export function isBibliographicMatch(
  hints: { title?: string; year?: number },
  candidate: { title: string; year?: number },
): boolean {
  return Boolean(hints.title) && titleSimilarity(hints.title!, candidate.title) >= 0.85 &&
    (hints.year == null || candidate.year == null || Math.abs(hints.year - candidate.year) <= 1);
}
