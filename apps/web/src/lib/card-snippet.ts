/**
 * Plain-text preview of a markdown body, for entity list cards.
 *
 * A title alone doesn't tell you which note or paper you're looking at, so the
 * card shows the opening few lines. Markup is stripped rather than rendered —
 * a card preview should never pull in images or links.
 *
 * `max` is a character budget, not a line count; the card clamps the rendered
 * height to three lines and the budget keeps the DOM small for long bodies.
 */
export function cardSnippet(body: string, max = 180): string {
  const text = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text === "No summary yet.") return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
