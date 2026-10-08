import assert from "node:assert/strict";
import test from "node:test";
import { loginForSessionToken } from "../infrastructure/mattermost-login";

test("loginForSessionToken: sends login credentials to upstream Mattermost", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ id: "user-1" }), {
      status: 200,
      headers: { Token: "sample-token-123" },
    });
  }) as typeof fetch;

  const token = await loginForSessionToken(
    "https://chat.example.com",
    "alice",
    "secret123",
    "654321",
    mockFetch,
  );

  assert.equal(token, "sample-token-123");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://chat.example.com/api/v4/users/login");
  assert.deepEqual(calls[0]?.body, {
    login_id: "alice",
    password: "secret123",
    token: "654321",
  });
});

test("loginForSessionToken: throws formatted error on 401 refusal", async () => {
  const mockFetch = (async () => {
    return new Response(JSON.stringify({ message: "Invalid credentials" }), {
      status: 401,
    });
  }) as typeof fetch;

  await assert.rejects(
    () => loginForSessionToken("https://chat.example.com", "alice", "wrong", undefined, mockFetch),
    /Mattermost rejected those credentials/,
  );
});

test("loginForSessionToken: throws when Token header is missing", async () => {
  const mockFetch = (async () => {
    return new Response(JSON.stringify({ id: "user-1" }), {
      status: 200,
    });
  }) as typeof fetch;

  await assert.rejects(
    () => loginForSessionToken("https://chat.example.com", "alice", "secret123", undefined, mockFetch),
    /did not expose the session token/,
  );
});
