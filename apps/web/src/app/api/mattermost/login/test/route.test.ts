import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../route";
import { mattermostLogin } from "../_login";
import { stubOutboundFetch } from "@/lib/test/stub-fetch";

const publicResolver = async () => ["93.184.216.34"];

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/mattermost/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

test("POST /api/mattermost/login: 400 when required fields are missing", async () => {
  const res = await post({});
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Mattermost server URL is required/);
});

test("POST /api/mattermost/login: 400 when serverUrl is not a valid URL", async () => {
  const res = await post({ serverUrl: "not-a-url", loginId: "user", password: "secret" });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /valid http\(s\) URL/);
});

test("mattermost login: refuses loopback, metadata and private addresses without dialling", async () => {
  const { calls, restore } = stubOutboundFetch(() => new Response("{}", { status: 200 }));
  try {
    for (const serverUrl of ["http://127.0.0.1:8065", "http://169.254.169.254", "http://10.0.0.5"]) {
      const res = await mattermostLogin({ serverUrl, loginId: "u", password: "p" });
      assert.equal(res.status, 400, serverUrl);
    }
    const rebound = await mattermostLogin(
      { serverUrl: "https://chat.example.com", loginId: "u", password: "p" },
      async () => ["192.168.1.10"],
    );
    assert.equal(rebound.status, 400);
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("mattermost login: 401 when upstream returns 401", async () => {
  const { restore } = stubOutboundFetch(() => new Response("Unauthorized", { status: 401 }));
  try {
    const res = await mattermostLogin(
      { serverUrl: "https://chat.example.com", loginId: "user", password: "wrong" },
      publicResolver,
    );
    assert.equal(res.status, 401);
    assert.match((await res.json()).error, /Mattermost rejected those credentials/);
  } finally {
    restore();
  }
});

test("mattermost login: 502 when upstream is unreachable", async () => {
  const { restore } = stubOutboundFetch(() => {
    throw new Error("Connection refused");
  });
  try {
    const res = await mattermostLogin(
      { serverUrl: "https://chat.example.com", loginId: "user", password: "secret" },
      publicResolver,
    );
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /Unable to reach the Mattermost server/);
  } finally {
    restore();
  }
});

test("mattermost login: 200 with token, dialling the vetted address", async () => {
  const { calls, restore } = stubOutboundFetch((url, init) => {
    assert.equal(url, "https://chat.example.com/api/v4/users/login");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.login_id, "testuser");
    assert.equal(body.password, "password123");
    assert.equal(body.token, "123456");
    return new Response(JSON.stringify({ id: "user-123" }), {
      status: 200,
      headers: { Token: "mm-session-token-xyz" },
    });
  });
  try {
    const res = await mattermostLogin(
      { serverUrl: "https://chat.example.com/some/path", loginId: "testuser", password: "password123", mfaToken: "123456" },
      publicResolver,
    );
    assert.equal(res.status, 200);
    assert.equal((await res.json()).token, "mm-session-token-xyz");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.address, "93.184.216.34");
  } finally {
    restore();
  }
});
