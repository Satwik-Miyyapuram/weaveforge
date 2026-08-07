import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { missingConfigMessage, readBackendConfig } from "../config";

describe("readBackendConfig", () => {
  it("defaults to supabase", () => {
    const c = readBackendConfig({});
    assert.equal(c.provider, "supabase");
  });

  it("reads supabase env vars", () => {
    const c = readBackendConfig({
      NEXT_PUBLIC_BACKEND_PROVIDER: "supabase",
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      SUPABASE_JWT_SECRET: "jwt",
      DATABASE_URL: "postgres://local",
    });
    assert.equal(c.supabaseUrl, "https://x.supabase.co");
    assert.equal(c.supabaseAnonKey, "anon");
    assert.equal(c.supabaseServiceRoleKey, "service");
    assert.equal(c.supabaseJwtSecret, "jwt");
    assert.equal(c.databaseUrl, "postgres://local");
  });

  it("falls back on unknown provider", () => {
    assert.equal(readBackendConfig({ NEXT_PUBLIC_BACKEND_PROVIDER: "firebase" }).provider, "supabase");
  });

  // The no-argument branch is a separate literal, because Next.js only inlines
  // `process.env.NEXT_PUBLIC_X` into the client bundle when it appears verbatim
  // in the source — a value reached through a bag is absent from the browser.
  //
  // Every test above passes a bag, so they all exercised the wrong branch. That
  // is how `dataUrl` came to be missing from the client path: reading it worked
  // everywhere the tests looked, and nowhere the browser ran. Setting
  // NEXT_PUBLIC_DATA_URL in Vercel changed nothing, silently.
  describe("the process.env branch the browser actually uses", () => {
    const vars = [
      "NEXT_PUBLIC_BACKEND_PROVIDER",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_DATA_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ] as const;

    function withEnv(values: Record<string, string>, run: () => void) {
      const saved = new Map(vars.map((v) => [v, process.env[v]]));
      try {
        for (const [k, v] of Object.entries(values)) process.env[k] = v;
        run();
      } finally {
        for (const [k, v] of saved) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    }

    it("reads NEXT_PUBLIC_DATA_URL — the cutover switch", () => {
      withEnv(
        {
          NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co",
          NEXT_PUBLIC_DATA_URL: "https://api.example.org",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
        },
        () => {
          const c = readBackendConfig();
          assert.equal(c.dataUrl, "https://api.example.org");
          // Auth must keep pointing at Supabase; only the data API moves.
          assert.equal(c.supabaseUrl, "https://proj.supabase.co");
        },
      );
    });

    it("leaves dataUrl undefined when unset, so the client stays on Supabase", () => {
      withEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co" }, () => {
        delete process.env.NEXT_PUBLIC_DATA_URL;
        assert.equal(readBackendConfig().dataUrl, undefined);
      });
    });
  });
});

test("missingConfigMessage names the absent env vars", () => {
  const cfg = readBackendConfig({
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  });
  const message = missingConfigMessage(cfg, ["supabaseUrl", "supabaseAnonKey", "supabaseServiceRoleKey"]);
  assert.ok(message?.includes("SUPABASE_SERVICE_ROLE_KEY"));
  assert.ok(!message?.includes("NEXT_PUBLIC_SUPABASE_URL"), "present vars are not named");
});

test("missingConfigMessage is null when everything required is set", () => {
  const cfg = readBackendConfig({
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  });
  assert.equal(missingConfigMessage(cfg, ["supabaseUrl", "supabaseAnonKey", "supabaseServiceRoleKey"]), null);
});

test("missingConfigMessage never echoes a secret value", () => {
  const secret = "super-secret-service-role-value";
  const cfg = readBackendConfig({
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: secret,
  });
  // These messages reach the browser, so only names may appear in them.
  const message = missingConfigMessage(cfg, ["supabaseUrl", "supabaseAnonKey", "supabaseServiceRoleKey"]);
  assert.ok(message?.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
  assert.ok(!message?.includes(secret), "secret value must never appear in the message");
});
