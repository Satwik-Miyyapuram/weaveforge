/**
 * Load every item at once and keep the ones that arrived, in input order.
 *
 * An export's figures are independent fetches; awaiting them one by one made
 * a page with many figures as slow as their sum. Order still matters — later
 * figures draw over earlier ones — so results land by index, and an item
 * whose load fails (a missing attachment) is simply left out.
 */
export async function loadInOrder<T, R>(
  items: readonly T[],
  load: (item: T) => Promise<R>,
): Promise<R[]> {
  const settled = await Promise.allSettled(
    items.map(async (item) => load(item)),
  );
  return settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
}
