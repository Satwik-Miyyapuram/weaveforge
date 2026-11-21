/**
 * A render's page proxy: the cached one, or one fetched for it.
 *
 * A fetched page is cached only while the render is still wanted. A page
 * evicted during the fetch would otherwise sit in the cache, holding its
 * pdf.js resources, until the document closed (P2-201). A cached page is left
 * alone when the render is stale: a newer render may be using it.
 */
export async function holdPageProxy<P extends { cleanup(): unknown }>(
  proxies: Map<number, P>,
  pageNumber: number,
  fetch: () => Promise<P>,
  isStale: () => boolean,
): Promise<P | null> {
  const cached = proxies.get(pageNumber);
  if (cached) return isStale() ? null : cached;
  const page = await fetch();
  if (isStale()) {
    if (proxies.get(pageNumber) !== page) {
      try {
        page.cleanup();
      } catch {
        /* ignore */
      }
    }
    return null;
  }
  proxies.set(pageNumber, page);
  return page;
}
