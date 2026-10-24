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

/**
 * The signing key used to fall back to the Supabase service-role key, then
 * the R2 secret, so a privileged credential doubled as the token key. Only
 * BLOB_VIEW_SECRET signs now; without it, minting and verifying fail closed.
 */
describe("blob-view-token secret", () => {
  const KEYS = ["BLOB_VIEW_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "R2_SECRET_ACCESS_KEY"] as const;
  const payload = {
    uid: "u1",
    bucket: "paper-images",
    path: "u1/p/a.webp",
    tier: "hot" as const,
    exp: Math.floor(Date.now() / 1000) + 60,
  };

  function withEnv(env: Partial<Record<(typeof KEYS)[number], string>>, run: () => void) {
    const saved = KEYS.map((key) => [key, process.env[key]] as const);
    for (const key of KEYS) delete process.env[key];
    Object.assign(process.env, env);
    try {
      run();
    } finally {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  it("signs with BLOB_VIEW_SECRET", () => {
    withEnv({ BLOB_VIEW_SECRET: "view-secret", SUPABASE_SERVICE_ROLE_KEY: "service-role" }, () => {
      const token = mintBlobViewToken(payload);
      assert.equal(verifyBlobViewToken(token, "view-secret")?.uid, "u1");
      assert.equal(verifyBlobViewToken(token, "service-role"), null);
    });
  });

  it("does not fall back to the service-role key", () => {
    withEnv({ SUPABASE_SERVICE_ROLE_KEY: "service-role" }, () => {
      assert.throws(() => mintBlobViewToken(payload), /BLOB_VIEW_SECRET/);
      assert.throws(() => verifyBlobViewToken("a.b"), /BLOB_VIEW_SECRET/);
    });
  });

  it("does not fall back to the R2 secret", () => {
    withEnv({ R2_SECRET_ACCESS_KEY: "r2-secret" }, () => {
      assert.throws(() => mintBlobViewToken(payload), /BLOB_VIEW_SECRET/);
    });
  });

  it("treats an empty BLOB_VIEW_SECRET as unset", () => {
    withEnv({ BLOB_VIEW_SECRET: "" }, () => {
      assert.throws(() => mintBlobViewToken(payload), /BLOB_VIEW_SECRET/);
    });
  });

  it("still builds URLs with an explicit secret and no env", () => {
    withEnv({}, () => {
      const url = blobContentUrl("http://localhost:3000", payload, 60, "explicit");
      assert.match(url, /\/api\/blobs\/content\?t=/);
    });
  });
});
