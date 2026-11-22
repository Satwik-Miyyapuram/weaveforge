/** PostgREST caps one response at max-rows (1000). Read pages until one comes back empty. */
export const PAGE_SIZE = 1000;

export async function listAllPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<T[]>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(offset, pageSize);
    if (page.length === 0) return all;
    all.push(...page);
  }
}
