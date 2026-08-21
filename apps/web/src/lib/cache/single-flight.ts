const inFlight = new Map<string, Promise<unknown>>();

/** Share identical concurrent work without caching its result. */
export function singleFlight<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const request = work().finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}
