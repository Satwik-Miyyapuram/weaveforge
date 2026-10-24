/**
 * Server blob helpers (B58).
 *
 * - 10-04: the routes already know the caller, so the helpers do not ask again.
 * - 10-05: one pair of S3 clients per config, not one per request.
 * - 10-18: a missing deployment setting is logged, not sent to the caller.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { blobFailure } from "@/app/api/blobs/_shared";
import { readStorageConfig } from "../config";
import { blobRegistryForToken, buildTieredBlobStoreForToken, hotColdStores } from "../server/blob-api";
import { BLOB_SERVER_ENV, withEnv } from "./with-env";

const R2 = { R2_ACCOUNT_ID: "acc", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "hot" };

function countingFetch() {
  const calls: string[] = [];
  const stub = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ message: "unexpected" }), { status: 401 });
  }) as typeof fetch;
  return { calls, stub };
}

test("the registry for a known caller costs no auth round trip (10-04)", async () => {
  const { calls, stub } = countingFetch();
  const registry = await withEnv(BLOB_SERVER_ENV, () => blobRegistryForToken("tok", "uid-1"), stub);
  assert.ok(registry);
  assert.deepEqual(calls, []);
});

test("the tiered store for a known caller costs no auth round trip (10-04)", async () => {
  const { calls, stub } = countingFetch();
  const store = await withEnv(
    BLOB_SERVER_ENV,
    () => buildTieredBlobStoreForToken("tok", "uid-1", readStorageConfig({ ...R2, BLOB_PROVIDER: "tiered" })),
    stub,
  );
  assert.ok(store);
  assert.deepEqual(calls, []);
});

test("two reads with one config share their S3 clients (10-05)", () => {
  const a = hotColdStores(readStorageConfig(R2));
  const b = hotColdStores(readStorageConfig(R2));
  assert.equal(a.hot, b.hot);
  assert.equal(a.cold, a.hot, "no cold tier configured: cold reads go to the hot store");
});

test("a changed config builds new clients", () => {
  const a = hotColdStores(readStorageConfig(R2));
  const b = hotColdStores(readStorageConfig({ ...R2, R2_BUCKET: "other" }));
  assert.notEqual(a.hot, b.hot);
  const c = hotColdStores(
    readStorageConfig({
      ...R2,
      BLOB_COLD_ENDPOINT: "http://minio.test",
      BLOB_COLD_ACCESS_KEY_ID: "ck",
      BLOB_COLD_SECRET_ACCESS_KEY: "cs",
      BLOB_COLD_BUCKET: "cold",
    }),
  );
  assert.notEqual(c.cold, c.hot);
  assert.equal(hotColdStores(readStorageConfig(R2)).hot, hotColdStores(readStorageConfig(R2)).hot);
});

test("no R2 config is still an error naming what is missing", () => {
  assert.throws(() => hotColdStores(readStorageConfig({})), /missing R2_ACCOUNT_ID/);
});

test("a missing deployment setting does not reach the response body (10-18)", async () => {
  const err = await withEnv(
    { ...BLOB_SERVER_ENV, NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined },
    () =>
      blobRegistryForToken("tok", "uid-1").then(
        () => null,
        (e: unknown) => e,
      ),
  );
  assert.ok(err instanceof Error);
  const res = blobFailure(err);
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error: string };
  assert.doesNotMatch(body.error, /NEXT_PUBLIC|SUPABASE|postgres|anon/i);
  assert.match(body.error, /not configured/i);
});
