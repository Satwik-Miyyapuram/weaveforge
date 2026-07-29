/** Force non-tiered blob provider for unit tests that assert the 503 guard. */
export async function withNonTieredBlobProvider<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.BLOB_PROVIDER;
  const prevPublic = process.env.NEXT_PUBLIC_BLOB_PROVIDER;
  process.env.BLOB_PROVIDER = "supabase";
  delete process.env.NEXT_PUBLIC_BLOB_PROVIDER;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.BLOB_PROVIDER;
    else process.env.BLOB_PROVIDER = prev;
    if (prevPublic === undefined) delete process.env.NEXT_PUBLIC_BLOB_PROVIDER;
    else process.env.NEXT_PUBLIC_BLOB_PROVIDER = prevPublic;
  }
}
