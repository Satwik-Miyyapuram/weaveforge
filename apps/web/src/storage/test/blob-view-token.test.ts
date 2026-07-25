import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  blobContentUrl,
  mintBlobViewToken,
  verifyBlobViewToken,
} from "../server/blob-view-token";

describe("blob-view-token", () => {
  const secret = "test-secret";

  it("round-trips a valid token", () => {
    const token = mintBlobViewToken(
      {
        uid: "user-1",
        bucket: "paper-images",
        path: "user-1/p1/a.webp",
        tier: "hot",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      secret,
    );
    const payload = verifyBlobViewToken(token, secret);
    assert.equal(payload?.uid, "user-1");
    assert.equal(payload?.path, "user-1/p1/a.webp");
  });

  it("rejects expired tokens", () => {
    const token = mintBlobViewToken(
      {
        uid: "user-1",
        bucket: "paper-images",
        path: "user-1/p1/a.webp",
        tier: "hot",
        exp: Math.floor(Date.now() / 1000) - 10,
      },
      secret,
    );
    assert.equal(verifyBlobViewToken(token, secret), null);
  });

  it("builds same-origin content URLs", () => {
    const url = blobContentUrl(
      "http://localhost:3000",
      { uid: "u1", bucket: "paper-images", path: "u1/p/a.webp", tier: "hot" },
      60,
      secret,
    );
    assert.match(url, /^http:\/\/localhost:3000\/api\/blobs\/content\?t=/);
  });
});
