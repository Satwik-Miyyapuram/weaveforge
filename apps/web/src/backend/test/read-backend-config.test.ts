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
