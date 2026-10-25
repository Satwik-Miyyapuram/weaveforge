/**
 * One demo chart from the PNGs served with the app, or null to skip the
 * figure. Never rejects: a network error mid-seed only loses that figure,
 * instead of aborting the seed after the project row exists.
 */
export async function fetchShowcaseChart(
  kind: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Blob | null> {
  try {
    const res = await fetchImpl(`/showcase/${kind}.png`);
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}
