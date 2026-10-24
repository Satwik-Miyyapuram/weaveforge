type Fetch = typeof globalThis.fetch;

/**
 * Run `fn` with some env vars set (undefined deletes one) and, optionally,
 * `fetch` replaced. Both are put back afterwards.
 */
export async function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
  fetchStub?: Fetch,
): Promise<T> {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const set = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };
  const originalFetch = globalThis.fetch;
  for (const [k, v] of Object.entries(vars)) set(k, v);
  if (fetchStub) globalThis.fetch = fetchStub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(before)) set(k, v);
  }
}

/** The data-backend env the blob server code reads: PostgREST, with a service key. */
export const BLOB_SERVER_ENV = {
  NEXT_PUBLIC_BACKEND_PROVIDER: undefined,
  NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  NEXT_PUBLIC_DATA_URL: undefined,
  SUPABASE_SERVICE_ROLE_KEY: "service",
  DATABASE_URL: undefined,
} as const;
