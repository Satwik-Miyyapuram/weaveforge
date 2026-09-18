/** Shared Semantic Scholar retry policy for metadata and citation endpoints. */
export async function fetchSemanticScholar(
  fetchFn: typeof fetch,
  url: string,
  init?: RequestInit,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<Response> {
  let response = await fetchFn(url, init);
  for (let attempt = 0; response.status === 429 && attempt < 3; attempt++) {
    await wait(1000 * (attempt + 1));
    response = await fetchFn(url, init);
  }
  return response;
}
