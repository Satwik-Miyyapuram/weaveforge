/** Something that loads before use and can be released. */
export interface Loadable {
  load(): Promise<void>;
  dispose(): void;
}

/**
 * Load `primary`; when it fails and there is a `fallback`, release `primary`
 * and load the fallback instead. Without one, the failure is rethrown and
 * `primary` stays the caller's to release. A fallback that fails is released
 * here, since nothing else holds it.
 *
 * Once `signal` aborts, no fallback is built (the primary stays the caller's),
 * and a fallback that finishes loading after it is released; both reject with
 * the signal's reason.
 *
 * The desktop shell uses this to fall back from its native encoder to the
 * web worker, so a broken native runtime never turns semantic search off.
 */
export async function loadWithFallback<T extends Loadable>(
  primary: T,
  fallback: (() => T) | null,
  onFallback: (error: unknown) => void = () => {},
  signal?: AbortSignal,
): Promise<T> {
  try {
    await primary.load();
    return primary;
  } catch (error) {
    if (!fallback) throw error;
    signal?.throwIfAborted();
    onFallback(error);
    primary.dispose();
    const next = fallback();
    try {
      await next.load();
      signal?.throwIfAborted();
    } catch (fallbackError) {
      next.dispose();
      throw fallbackError;
    }
    return next;
  }
}
