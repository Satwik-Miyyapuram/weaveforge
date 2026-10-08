import test from "node:test";
import assert from "node:assert/strict";
import { mattermostOrigin, postToMattermost, sessionTokenFrom, tokenWorks } from "../src/mattermost-signin";

const ORIGIN = "https://mattermost.example.org";

test("mattermost sign-in: only http(s) servers open a window", () => {
  assert.equal(mattermostOrigin(" https://mattermost.example.org/team/x "), ORIGIN);
  assert.equal(mattermostOrigin("file:///etc/passwd"), null);
  assert.equal(mattermostOrigin("not a url"), null);
  assert.equal(mattermostOrigin(42), null);
});

test("mattermost sign-in: takes the session cookie the server set, nothing else", () => {
  const cookie = (name: string, domain: string, value = "tok") => ({ name, value, domain });
  assert.equal(sessionTokenFrom(cookie("MMAUTHTOKEN", "mattermost.example.org"), ORIGIN, false), "tok");
  assert.equal(sessionTokenFrom(cookie("MMAUTHTOKEN", ".example.org"), ORIGIN, false), "tok");
  assert.equal(sessionTokenFrom(cookie("MMAUTHTOKEN", "mattermost.example.org"), ORIGIN, true), null, "removed");
  assert.equal(sessionTokenFrom(cookie("MMUSERID", "mattermost.example.org"), ORIGIN, false), null);
  assert.equal(sessionTokenFrom(cookie("MMAUTHTOKEN", "evil.org"), ORIGIN, false), null);
  assert.equal(sessionTokenFrom(cookie("MMAUTHTOKEN", "mattermost.example.org", ""), ORIGIN, false), null);
});

test("mattermost sign-in: a token is kept only when it signs in", async () => {
  const seen: string[] = [];
  const answer = (status: number): typeof fetch => async (url, init) => {
    seen.push(`${String(url)} ${new Headers(init?.headers).get("authorization")}`);
    return new Response("{}", { status });
  };
  assert.equal(await tokenWorks(ORIGIN, "tok", answer(200)), true);
  assert.deepEqual(seen, [`${ORIGIN}/api/v4/users/me Bearer tok`]);
  assert.equal(await tokenWorks(ORIGIN, "tok", answer(401)), false);
  assert.equal(await tokenWorks(ORIGIN, "tok", () => Promise.reject(new Error("offline"))), false);
});

test("mattermost post: sent from main to the server's posts endpoint", async () => {
  const seen: Array<{ url: string; auth: string | null; body: unknown }> = [];
  const answer = (status: number, text = ""): typeof fetch => async (url, init) => {
    seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) });
    return new Response(text, { status });
  };
  const req = { serverUrl: `${ORIGIN}/team/x`, token: "tok", channelId: "ch", message: "hi" };
  assert.deepEqual(await postToMattermost(req, answer(201)), { status: 201, body: "" });
  assert.deepEqual(seen[0], { url: `${ORIGIN}/api/v4/posts`, auth: "Bearer tok", body: { channel_id: "ch", message: "hi" } });
  assert.deepEqual(await postToMattermost(req, answer(403, "nope")), { status: 403, body: "nope" });
  await assert.rejects(postToMattermost({ ...req, serverUrl: "file:///x" }, answer(200)), /valid http/);
  await assert.rejects(postToMattermost({ ...req, token: 5 }, answer(200)), /token/);
});
