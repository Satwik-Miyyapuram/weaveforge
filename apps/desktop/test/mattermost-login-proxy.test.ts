import test from "node:test";
import assert from "node:assert/strict";
import { answerRelay } from "../src/app-relays";
import { isMattermostLoginRequest, proxyMattermostLogin } from "../src/mattermost-login-proxy";
import type { ProxyFetch } from "../src/semantic-scholar-proxy";

/**
 * The shell's Mattermost sign-in relay: the static bundle has no
 * `/api/mattermost/login`, so the desktop sign-in form got a 404.
 */

const APP = "app://weaveforge";

function answering(status: number, headers: Record<string, string> = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn: ProxyFetch = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(new Response("{}", { status, headers }));
  };
  return { fetchFn, calls };
}

const login = (body: object, method = "POST") =>
  new Request(`${APP}/api/mattermost/login`, {
    method,
    headers: { "content-type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });

const NETID = { serverUrl: "https://mattermost.example.org/team", loginId: "netid", password: "pw" };

test("only /api/mattermost/login is the relay", () => {
  assert.equal(isMattermostLoginRequest(`${APP}/api/mattermost/login`), true);
  assert.equal(isMattermostLoginRequest(`${APP}/api/mattermost/login/x`), false);
});

test("answerRelay answers the sign-in instead of leaving it to the bundle", async () => {
  const { fetchFn } = answering(200, { Token: "tok" });
  const relayed = answerRelay(login(NETID), fetchFn);
  assert.ok(relayed, "sign-in fell through to the bundle (404)");
  assert.equal((await relayed).status, 200);
});

test("posts to the server's login endpoint and returns only the token", async () => {
  const { fetchFn, calls } = answering(200, { Token: "tok" });
  const res = await proxyMattermostLogin(login({ ...NETID, mfaToken: " 123456 " }), fetchFn);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { token: "tok" });
  assert.equal(calls[0]?.url, "https://mattermost.example.org/api/v4/users/login");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { login_id: "netid", password: "pw", token: "123456" });
});

test("maps upstream failures to messages the form shows", async () => {
  const rejected = await proxyMattermostLogin(login(NETID), answering(401).fetchFn);
  assert.equal(rejected.status, 401);
  assert.match((await rejected.json()).error, /rejected those credentials/);

  const noToken = await proxyMattermostLogin(login(NETID), answering(200).fetchFn);
  assert.equal(noToken.status, 502);

  const down: ProxyFetch = () => Promise.reject(new Error("offline"));
  assert.equal((await proxyMattermostLogin(login(NETID), down)).status, 502);
});

test("refuses bad input without calling upstream", async () => {
  const { fetchFn, calls } = answering(200, { Token: "tok" });
  assert.equal((await proxyMattermostLogin(login({ ...NETID, password: "" }), fetchFn)).status, 400);
  assert.equal((await proxyMattermostLogin(login({ ...NETID, serverUrl: "file:///etc" }), fetchFn)).status, 400);
  assert.equal((await proxyMattermostLogin(login(NETID, "GET"), fetchFn)).status, 405);
  assert.equal(calls.length, 0);
});
