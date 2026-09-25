/**
 * Run work over a collection at most `limit` at a time.
 *
 * `Promise.all` is the right shape for a small fixed set and the wrong one for
 * a user-sized one. Choosing twenty figures starts twenty uploads; a screen with
 * twelve stale runs issues twelve PATCHes; on a phone connection that saturates
 * the radio for everything else, including the request the user is waiting on.
 * HTTP/2 multiplexing helps a little and does not change the arithmetic.
 *
 * The bound is a constant in the code rather than something a caller can grow.
 * Order is preserved, so the result can still be zipped against the input, and
 * a rejection propagates as it would from `Promise.all` — the callers that want
 * failures absorbed say so themselves, per item.
 */
export async function mapLimit<T, R>(
  inputs: readonly T[],
  limit: number,
  work: (input: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) throw new RangeError("mapLimit needs a concurrency limit of at least 1");
  const results = new Array<R>(inputs.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, inputs.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= inputs.length) return;
      results[index] = await work(inputs[index]!, index);
    }
  });
  await Promise.all(runners);
  return results;
}
