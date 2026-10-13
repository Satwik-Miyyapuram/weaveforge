import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOtpOrLink } from "../delete-account-otp";

test("parseOtpOrLink: parses standard 6-digit OTP code", () => {
  const result = parseOtpOrLink("123456");
  assert.deepEqual(result, { token: "123456" });
});

test("parseOtpOrLink: trims whitespace around 6-digit OTP", () => {
  const result = parseOtpOrLink("  654321 \n");
  assert.deepEqual(result, { token: "654321" });
});

test("parseOtpOrLink: parses 8-digit OTP code", () => {
  const result = parseOtpOrLink("12345678");
  assert.deepEqual(result, { token: "12345678" });
});

test("parseOtpOrLink: parses confirmation URL with token_hash", () => {
  const url = "https://app.example.com/auth/confirm?token_hash=pkce_abc123def456ghi789&type=email";
  const result = parseOtpOrLink(url);
  assert.deepEqual(result, { token_hash: "pkce_abc123def456ghi789" });
});

test("parseOtpOrLink: parses confirmation URL with numeric token", () => {
  const url = "https://app.example.com/auth/confirm?token=654321&type=email";
  const result = parseOtpOrLink(url);
  assert.deepEqual(result, { token: "654321" });
});

test("parseOtpOrLink: parses confirmation URL with hash token parameter", () => {
  const url = "https://app.example.com/auth/confirm?token=pkce_abc123def456ghi789&type=email";
  const result = parseOtpOrLink(url);
  assert.deepEqual(result, { token_hash: "pkce_abc123def456ghi789" });
});

test("parseOtpOrLink: parses query string fragment with token_hash", () => {
  const fragment = "token_hash=pkce_abc123def456ghi789&type=email";
  const result = parseOtpOrLink(fragment);
  assert.deepEqual(result, { token_hash: "pkce_abc123def456ghi789" });
});

test("parseOtpOrLink: parses raw token_hash string", () => {
  const hash = "pkce_abc123def456ghi789_long_hash";
  const result = parseOtpOrLink(hash);
  assert.deepEqual(result, { token_hash: hash });
});

test("parseOtpOrLink: returns empty for invalid input", () => {
  assert.deepEqual(parseOtpOrLink(""), {});
  assert.deepEqual(parseOtpOrLink("abc"), {});
  assert.deepEqual(parseOtpOrLink("not a valid code"), {});
});
