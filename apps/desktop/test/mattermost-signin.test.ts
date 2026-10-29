import test from "node:test";
import assert from "node:assert/strict";
import { CHANNELS } from "../src/channels";
import type { IpcSurface } from "../src/ipc-guard";
import {
  mattermostOrigin,
  postToMattermost,
  registerMattermostSignIn,
  sessionTokenFrom,
  tokenWorks,
} from "../src/mattermost-signin";

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

/** The sign-in handler with the window step replaced, callable without Electron. */
function signInHandler(signIn: (origin: string) => Promise<string | null>) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc: IpcSurface = {
    handle: (channel, listener) => void handlers.set(channel, (...args) => listener({} as never, ...args)),
    on: () => undefined,
  };
  registerMattermostSignIn({ ipc, mainWindow: () => null, signIn });
  return (url: unknown) =>
    handlers.get(CHANNELS.mattermostSignIn)!(url) as Promise<{ ok: boolean; value?: unknown; message?: string }>;
}

test("mattermost sign-in: a window that fails answers ok:false, and the next try opens again (xipc-09)", async () => {
  let fail = true;
  const opened: string[] = [];
  const call = signInHandler(async (origin) => {
    opened.push(origin);
    if (fail) throw new Error("window crashed");
    return "tok";
  });
  const first = await call(ORIGIN);
  assert.equal(first.ok, false);
  assert.match(first.message ?? "", /window crashed/);
  fail = false;
  assert.deepEqual(await call(ORIGIN), { ok: true, value: "tok" });
  assert.deepEqual(opened, [ORIGIN, ORIGIN]);
});

test("mattermost sign-in: a non-Error failure still answers with a reason", async () => {
  const reply = await signInHandler(() => Promise.reject("nope"))(ORIGIN);
  assert.equal(reply.ok, false);
  assert.match(reply.message ?? "", /Mattermost/);
});

test("mattermost sign-in: a second click joins the open window", async () => {
  let release!: (t: string) => void;
  let opened = 0;
  const call = signInHandler(() => {
    opened += 1;
    return new Promise((resolve) => { release = resolve; });
  });
  const a = call(ORIGIN);
  const b = call(ORIGIN);
  await new Promise((r) => setImmediate(r));
  release("tok");
  assert.deepEqual(await a, { ok: true, value: "tok" });
  assert.deepEqual(await b, { ok: true, value: "tok" });
  assert.equal(opened, 1);
});
