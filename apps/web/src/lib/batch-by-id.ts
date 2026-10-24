/**
 * Reads by id, gathered: every id asked for in the same tick goes out as one
 * batch read, so a list of N cards that each ask for their row costs one
 * request rather than N.
 *
 * A lone id still goes through `one`, which a read memo may serve; so does
 * every id when there is no batch read. A failed batch rejects each request in
 * it, and the next tick starts a new batch.
 */
export function batchById<T extends { id: string }>(
  one: (id: string) => Promise<T | null>,
  many?: (ids: readonly string[]) => Promise<T[]>,
): (id: string) => Promise<T | null> {
  let pending: Map<string, { resolve: (row: T | null) => void; reject: (err: unknown) => void }[]> | null = null;

  const flush = async (batch: NonNullable<typeof pending>) => {
    const ids = [...batch.keys()];
    try {
      let found: (T | null)[];
      if (ids.length === 1) found = [await one(ids[0]!)];
      else if (many) found = await many(ids);
      else found = await Promise.all(ids.map(one));
      const byId = new Map(found.filter((row): row is T => row != null).map((row) => [row.id, row]));
      for (const [id, waiters] of batch) for (const w of waiters) w.resolve(byId.get(id) ?? null);
    } catch (err) {
      for (const waiters of batch.values()) for (const w of waiters) w.reject(err);
    }
  };

  return (id) =>
    new Promise<T | null>((resolve, reject) => {
      if (!pending) {
        const batch = new Map<string, { resolve: (row: T | null) => void; reject: (err: unknown) => void }[]>();
        pending = batch;
        queueMicrotask(() => {
          pending = null;
          void flush(batch);
        });
      }
      const waiters = pending.get(id) ?? [];
      waiters.push({ resolve, reject });
      pending.set(id, waiters);
    });
}
