import assert from "node:assert/strict";
import test from "node:test";
import {
  API_TOKEN_PREFIX,
  expiryFromDays,
  generateApiToken,
  hashApiToken,
  isApiTokenFormat,
} from "../api-token-crypto.js";
import { signSupabaseAccessJwt } from "../sign-supabase-jwt.js";

test("generateApiToken produces tt_ prefix and stable hash", () => {
  const a = generateApiToken();
  assert.ok(a.plaintext.startsWith(API_TOKEN_PREFIX));
  assert.equal(Buffer.from(hashApiToken(a.plaintext)).toString("hex"), Buffer.from(a.hash).toString("hex"));
  assert.ok(a.prefix.endsWith("…"));
});

test("isApiTokenFormat accepts tt_ tokens only", () => {
  const { plaintext } = generateApiToken();
  assert.equal(isApiTokenFormat(plaintext), true);
  assert.equal(isApiTokenFormat("eyJhbG.abc.def"), false);
  assert.equal(isApiTokenFormat("tt_short"), false);
});

test("expiryFromDays returns ISO date or null", () => {
  assert.equal(expiryFromDays(null), null);
  assert.equal(expiryFromDays(0), null);
  const iso = expiryFromDays(7);
  assert.ok(iso);
  assert.ok(new Date(iso!).getTime() > Date.now());
});

test("signSupabaseAccessJwt is a three-part JWT", () => {
  const jwt = signSupabaseAccessJwt("00000000-0000-4000-8000-000000000001", "test-secret");
  assert.match(jwt, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});
