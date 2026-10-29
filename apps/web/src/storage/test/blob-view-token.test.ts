import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BLOB_VIEW_STEP_S,
  blobCacheControl,
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

/**
 * A figure used to be re-downloaded on every view: each signing minted a new
 * expiry (to the second), so a new URL, and the route said `no-store`. Now the
 * expiry rounds up to a five-minute step, so signing again within it gives the
 * same URL, and the browser may keep the bytes until the token dies.
 */
describe("blob view caching", () => {
  const p = { uid: "u1", bucket: "experiment-artifacts", path: "u1/e/x.png", tier: "hot" as const };

  it("signing twice in the same step gives the same URL", () => {
    const now = 1_700_000_000_000; // a step starts at 1_700_003_400 s
    assert.equal(
      blobContentUrl("http://h", p, 3600, "s", now),
      blobContentUrl("http://h", p, 3600, "s", now + 30_000),
    );
  });

  it("a token never lives less than asked, and at most one step more", () => {
    const now = Date.now();
    const url = blobContentUrl("http://h", p, 3600, "s", now);
    const exp = verifyBlobViewToken(decodeURIComponent(url.split("t=")[1] ?? ""), "s")?.exp ?? 0;
    const nowS = Math.floor(now / 1000);
    assert.ok(exp >= nowS + 3600, `${exp}`);
    assert.ok(exp <= nowS + 3600 + BLOB_VIEW_STEP_S, `${exp}`);
    assert.equal(exp % BLOB_VIEW_STEP_S, 0);
  });

  it("the browser keeps the bytes privately, and only until the token expires", () => {
    assert.equal(blobCacheControl(1_000_600, 1_000_000_000), "private, max-age=600, immutable");
    assert.equal(blobCacheControl(999, 1_000_000), "private, no-store");
  });
});
