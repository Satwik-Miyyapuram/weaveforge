import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../route";
import { stubFetch } from "@/lib/test/stub-fetch";

test("POST /api/mattermost/login: 400 when required fields are missing", async () => {
  const res = await POST(
    new Request("http://localhost/api/mattermost/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  );
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /Mattermost server URL is required/);
});

test("POST /api/mattermost/login: 400 when serverUrl is not a valid URL", async () => {
  const res = await POST(
    new Request("http://localhost/api/mattermost/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverUrl: "not-a-url",
        loginId: "user",
        password: "secret",
      }),
    }),
  );
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /valid http\(s\) URL/);
});

test("POST /api/mattermost/login: 401 when upstream returns 401", async () => {
  const { restore } = stubFetch(() => new Response("Unauthorized", { status: 401 }));
  try {
    const res = await POST(
      new Request("http://localhost/api/mattermost/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverUrl: "https://chat.example.com",
          loginId: "user",
          password: "wrong",
        }),
      }),
    );
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.match(data.error, /Mattermost rejected those credentials/);
  } finally {
    restore();
  }
});

test("POST /api/mattermost/login: 502 when upstream is unreachable", async () => {
  const { restore } = stubFetch(() => {
    throw new Error("Connection refused");
  });
  try {
    const res = await POST(
      new Request("http://localhost/api/mattermost/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverUrl: "https://chat.example.com",
          loginId: "user",
          password: "secret",
        }),
      }),
    );
    assert.equal(res.status, 502);
    const data = await res.json();
    assert.match(data.error, /Unable to reach the Mattermost server/);
  } finally {
    restore();
  }
});

test("POST /api/mattermost/login: 200 with token on successful login", async () => {
  const { calls, restore } = stubFetch((url, init) => {
    assert.equal(url, "https://chat.example.com/api/v4/users/login");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.login_id, "testuser");
    assert.equal(body.password, "password123");
    assert.equal(body.token, "123456");
    return new Response(JSON.stringify({ id: "user-123" }), {
      status: 200,
      headers: {
        Token: "mm-session-token-xyz",
      },
    });
  });
  try {
    const res = await POST(
      new Request("http://localhost/api/mattermost/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverUrl: "https://chat.example.com",
          loginId: "testuser",
          password: "password123",
          mfaToken: "123456",
        }),
      }),
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.token, "mm-session-token-xyz");
    assert.equal(calls.length, 1);
  } finally {
    restore();
  }
});
