/** Cross-hook in-flight + settled cache for blob fetches. */

const settled = new Map<string, Blob>();
const inflight = new Map<string, Promise<Blob | null>>();

function cacheKey(bucket: string, path: string): string {
  return `${bucket}\0${path}`;
}

function fetchBlobCached(
  bucket: string,
  path: string,
  fetcher: (path: string) => Promise<Blob>,
): Promise<Blob | null> {
  const key = cacheKey(bucket, path);
  const hit = settled.get(key);
  if (hit) return Promise.resolve(hit);

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = fetcher(path)
    .then((blob) => {
      settled.set(key, blob);
      return blob;
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

export async function fetchBlobsCached(
  bucket: string,
  paths: readonly string[],
  fetchOne: (path: string) => Promise<Blob>,
  fetchBatch?: (paths: string[]) => Promise<Map<string, Blob>>,
): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>();
  const missing: string[] = [];

  for (const path of paths) {
    const hit = settled.get(cacheKey(bucket, path));
    if (hit) out.set(path, hit);
    else missing.push(path);
  }

  if (missing.length === 0) return out;

  if (fetchBatch && missing.length > 1) {
    const batch = await fetchBatch(missing);
    for (const [path, blob] of batch) {
      settled.set(cacheKey(bucket, path), blob);
      out.set(path, blob);
    }
    return out;
  }

  await Promise.all(
    missing.map(async (path) => {
      const blob = await fetchBlobCached(bucket, path, fetchOne);
      if (blob) out.set(path, blob);
    }),
  );
  return out;
}
