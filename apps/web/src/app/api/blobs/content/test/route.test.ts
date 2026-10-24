import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../route";
import { withNonTieredBlobProvider } from "@/storage/test/with-non-tiered-blob-provider";
import { BLOB_SERVER_ENV, withEnv } from "@/storage/test/with-env";
import { mintBlobViewToken } from "@/storage/server/blob-view-token";

// Default dev/test storage provider is "supabase", so the tiered-only content
// route short-circuits with 503 before any token handling. (When BLOB_PROVIDER
// is "tiered" it instead 400s on a missing token — covered by e2e/integration.)
test("GET /api/blobs/content: 503 when the provider is not tiered", async () => {
  await withNonTieredBlobProvider(async () => {
    const res = await GET(new Request("http://localhost/api/blobs/content"));
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /not tiered/);
  });
});

const TIERED = { ...BLOB_SERVER_ENV, NEXT_PUBLIC_BLOB_PROVIDER: "tiered", BLOB_VIEW_SECRET: "test-secret" };

function contentRequest() {
  const t = mintBlobViewToken(
    {
      uid: "11111111-1111-4111-8111-111111111111",
      bucket: "paper-images",
      path: "11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/x.png",
      tier: "hot",
      exp: Math.floor(Date.now() / 1000) + 60,
    },
    "test-secret",
  );
  return new Request(`http://localhost/api/blobs/content?t=${encodeURIComponent(t)}`);
}

const answer = (body: unknown, status: number) =>
  (async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as typeof fetch;

test("GET /api/blobs/content: a failed lookup is a 502, not a 404 (10-07)", async () => {
  const res = await withEnv(
    TIERED,
    () => GET(contentRequest()),
    answer({ message: "permission denied for table blob_objects", code: "42501" }, 500),
  );
  assert.equal(res.status, 502);
  assert.doesNotMatch((await res.json()).error, /blob_objects/);
});

test("GET /api/blobs/content: an unregistered blob is still a 404", async () => {
  const res = await withEnv(TIERED, () => GET(contentRequest()), answer([], 200));
  assert.equal(res.status, 404);
});
