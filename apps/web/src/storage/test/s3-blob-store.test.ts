/**
 * Minting a signed URL is local work (B58, 10-02). It used to GET every object
 * first, per path, and never read the body it opened.
 *
 * A path with no object still gets no URL from the tiered store: that answer
 * comes from the registry, which `tiered-blob-store.test.ts` covers.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { S3Client } from "@aws-sdk/client-s3";
import { S3BlobStore } from "../providers/s3/s3-blob-store";

test("signedUrls makes no request to the object store", async () => {
  const client = new S3Client({
    region: "auto",
    endpoint: "https://acc.r2.cloudflarestorage.com",
    forcePathStyle: true,
    credentials: { accessKeyId: "k", secretAccessKey: "s" },
  });
  let sends = 0;
  client.send = (async () => {
    sends += 1;
    throw new Error("no network in tests");
  }) as typeof client.send;
  const urls = await new S3BlobStore(client, "hot").signedUrls("paper-images", ["u/p/a.png", "u/p/b.png"], 60);
  assert.equal(sends, 0);
  assert.equal(urls.length, 2);
  assert.match(urls[0]!, /\/hot\/paper-images\/u\/p\/a\.png\?/);
  assert.match(urls[1]!, /X-Amz-Expires=60/);
});

test("no paths mints nothing", async () => {
  const client = new S3Client({ region: "auto", credentials: { accessKeyId: "k", secretAccessKey: "s" } });
  assert.deepEqual(await new S3BlobStore(client, "hot").signedUrls("paper-images", [], 60), []);
});
