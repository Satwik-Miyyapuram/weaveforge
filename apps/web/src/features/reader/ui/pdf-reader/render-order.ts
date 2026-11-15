/** A page's vertical extent, in the same coordinates as the viewport centre. */
export interface PageExtent {
  page: number;
  top: number;
  bottom: number;
}

/**
 * Page numbers ordered by distance from `centre`: a page that covers it is 0
 * away, others by their nearest edge. Ties keep the given order.
 */
export function nearestFirst(pages: readonly PageExtent[], centre: number): number[] {
  const distance = ({ top, bottom }: PageExtent) =>
    centre < top ? top - centre : centre > bottom ? centre - bottom : 0;
  return pages
    .map((extent, index) => ({ page: extent.page, away: distance(extent), index }))
    .sort((a, b) => a.away - b.away || a.index - b.index)
    .map(({ page }) => page);
}
