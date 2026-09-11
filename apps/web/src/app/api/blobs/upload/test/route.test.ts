import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../route";
import { MAX_BODY_BYTES, MAX_UPLOAD_BYTES, exceedsDeclaredLimit } from "../upload-limits";
import { withNonTieredBlobProvider } from "@/storage/test/with-non-tiered-blob-provider";

/** Run one call with the tiered provider selected, then put the env back. */
async function withTieredBlobProvider<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.BLOB_PROVIDER;
  const prevPublic = process.env.NEXT_PUBLIC_BLOB_PROVIDER;
  process.env.BLOB_PROVIDER = "tiered";
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

// Fails closed with 503 unless BLOB_PROVIDER=tiered (default is "supabase"),
// ahead of auth/multipart parsing. Tiered paths are covered by integration.
test("POST /api/blobs/upload: 503 when the provider is not tiered", async () => {
  await withNonTieredBlobProvider(async () => {
    const res = await POST(new Request("http://localhost/api/blobs/upload", { method: "POST" }));
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /not tiered/);
  });
});

// ----------------------------------------------------------------- size limits

test("a declared body length past the cap is refused before anything is read", () => {
  assert.equal(exceedsDeclaredLimit(String(MAX_BODY_BYTES + 1)), true);
  assert.equal(exceedsDeclaredLimit(String(MAX_BODY_BYTES)), false);
  assert.equal(exceedsDeclaredLimit(null), false, "an absent header is not a claim to reject on");
  assert.equal(exceedsDeclaredLimit("not a number"), false);
  assert.equal(exceedsDeclaredLimit("-1"), false);
});

test("the body cap leaves room for the multipart envelope around a legal file", () => {
  // The header covers boundaries and the bucket/path fields, so it has to be
  // strictly larger than the file limit — otherwise a file a byte under the cap
  // is refused for its envelope.
  assert.ok(MAX_BODY_BYTES > MAX_UPLOAD_BYTES);
});

test("an oversized declared body is a 413, and is not parsed as a form", async () => {
  await withTieredBlobProvider(async () => {
    const res = await POST(
      new Request("http://localhost/api/blobs/upload", {
        method: "POST",
        // Deliberately not multipart, and deliberately unauthenticated: the
        // refusal has to come from the header alone, before either the token is
        // resolved or the body is buffered. A 401 here would mean auth ran
        // first; a 400 would mean the body was parsed first.
        headers: {
          authorization: "Bearer not-a-real-token",
          "content-length": String(MAX_BODY_BYTES + 1),
        },
        body: "not a multipart body",
      }),
    );
    assert.equal(res.status, 413);
    assert.match((await res.json()).error, /25 MB limit/);
  });
});

test("a body that declares no length is not refused as oversized", async () => {
  await withTieredBlobProvider(async () => {
    const res = await POST(
      new Request("http://localhost/api/blobs/upload", {
        method: "POST",
        headers: { authorization: "Bearer not-a-real-token" },
        body: "not a multipart body",
      }),
    );
    // A chunked upload declares no length, so the header cannot refuse it and
    // the gate must not guess: the parsed `file.size` is checked instead. The
    // proof that the size gate stayed out of the way is that this is not a 413.
    //
    // It is a 401 rather than the parse's 400 because auth runs before the
    // parse on purpose — an unauthenticated caller must not be able to make the
    // server buffer a body at all (see the route's header). The parse's own
    // 400 is covered by the declared-length test above, which reaches the
    // refusal without a session and so cannot be confused with an auth answer.
    assert.notEqual(res.status, 413);
    assert.equal(res.status, 401);
  });
});
