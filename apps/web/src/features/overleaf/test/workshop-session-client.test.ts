import test from "node:test";
import assert from "node:assert/strict";
import {
  listWorkshopProjects,
  signInToWorkshop,
  signOutOfWorkshop,
  type WorkshopClientDeps,
} from "../infrastructure/workshop-session-client";

const SESSION = "3f6c2a9e-1b2d-4c5e-8f70-123456789abc";

interface Call {
  url: string;
  init: RequestInit;
}

function makeDeps(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const deps: WorkshopClientDeps = {
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return respond();
    },
    authHeaders: async (extra) => ({ ...(extra as Record<string, string>), Authorization: "Bearer test-token" }),
  };
  return { deps, calls };
}

const json = (body: unknown, status = 200) => () =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// --- sign-in -------------------------------------------------------------

test("sign-in POSTs the trimmed cookie with the bearer header and returns the session id", async () => {
  const { deps, calls } = makeDeps(json({ sessionId: SESSION }, 201));
  const result = await signInToWorkshop(deps, "  overleaf_session2=abc  ");
  assert.deepEqual(result, { ok: true, sessionId: SESSION });
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.url, "/api/overleaf/workshop/session");
  assert.equal(call.init.method, "POST");
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer test-token");
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(String(call.init.body)), { cookies: "overleaf_session2=abc" });
});

test("a blank cookie is refused before any request", async () => {
  const { deps, calls } = makeDeps(json({ sessionId: SESSION }, 201));
  const result = await signInToWorkshop(deps, "   ");
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test("sign-in shows the server's error when Overleaf rejects the cookie", async () => {
  const { deps } = makeDeps(json({ error: "Overleaf sign-in failed." }, 401));
  assert.deepEqual(await signInToWorkshop(deps, "bad"), { ok: false, message: "Overleaf sign-in failed." });
});

test("sign-in falls back to the HTTP status when the error body is not JSON", async () => {
  const { deps } = makeDeps(() => new Response("<html>gateway</html>", { status: 502 }));
  const result = await signInToWorkshop(deps, "c");
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /502/);
});

test("a success without a valid session id is an error, not a session", async () => {
  const { deps } = makeDeps(json({ sessionId: "not-a-uuid" }, 201));
  assert.equal((await signInToWorkshop(deps, "c")).ok, false);
});

test("a network failure or a signed-out app becomes a message, never a throw", async () => {
  const down: WorkshopClientDeps = {
    fetch: async () => { throw new Error("offline"); },
    authHeaders: async (extra) => extra ?? {},
  };
  const net = await signInToWorkshop(down, "c");
  assert.equal(net.ok, false);
  assert.match(net.ok ? "" : net.message, /offline/);

  const signedOut: WorkshopClientDeps = {
    fetch: async () => json({ sessionId: SESSION }, 201)(),
    authHeaders: async () => { throw new Error("Not signed in."); },
  };
  const out = await signInToWorkshop(signedOut, "c");
  assert.equal(out.ok, false);
  assert.match(out.ok ? "" : out.message, /Not signed in/);
});

// --- projects ------------------------------------------------------------

test("projects POSTs the session id and returns id/name pairs sorted by name", async () => {
  const { deps, calls } = makeDeps(json({ projects: [{ id: "b2", name: "Thesis" }, { id: "a1", name: "Abstract" }] }));
  const result = await listWorkshopProjects(deps, SESSION);
  assert.deepEqual(result, { ok: true, projects: [{ id: "a1", name: "Abstract" }, { id: "b2", name: "Thesis" }] });
  const call = calls[0]!;
  assert.equal(call.url, "/api/overleaf/workshop/projects");
  assert.equal(call.init.method, "POST");
  assert.deepEqual(JSON.parse(String(call.init.body)), { sessionId: SESSION });
});

test("projects drops malformed entries instead of rendering them", async () => {
  const { deps } = makeDeps(json({ projects: [{ id: "a1", name: "Ok" }, { id: 7, name: "bad" }, null, { name: "no id" }] }));
  assert.deepEqual(await listWorkshopProjects(deps, SESSION), { ok: true, projects: [{ id: "a1", name: "Ok" }] });
});

test("an empty project list is a success with no projects", async () => {
  const { deps } = makeDeps(json({ projects: [] }));
  assert.deepEqual(await listWorkshopProjects(deps, SESSION), { ok: true, projects: [] });
});

test("a 401 on projects marks the stored session as expired", async () => {
  const { deps } = makeDeps(json({ error: "Overleaf session not found. Sign in again." }, 401));
  const result = await listWorkshopProjects(deps, SESSION);
  assert.deepEqual(result, { ok: false, expired: true, message: "Overleaf session not found. Sign in again." });
});

test("a 502 on projects is an error but keeps the session", async () => {
  const { deps } = makeDeps(json({ error: "Overleaf projects could not be listed." }, 502));
  assert.deepEqual(await listWorkshopProjects(deps, SESSION), {
    ok: false,
    expired: false,
    message: "Overleaf projects could not be listed.",
  });
});

test("a body without a projects array is an error", async () => {
  const { deps } = makeDeps(json({ nope: true }));
  assert.equal((await listWorkshopProjects(deps, SESSION)).ok, false);
});

// --- sign-out ------------------------------------------------------------

test("sign-out DELETEs the session with the id encoded in the query", async () => {
  const { deps, calls } = makeDeps(json({ ok: true }));
  await signOutOfWorkshop(deps, SESSION);
  const call = calls[0]!;
  assert.equal(call.url, `/api/overleaf/workshop/session?id=${SESSION}`);
  assert.equal(call.init.method, "DELETE");
  assert.equal((call.init.headers as Record<string, string>).Authorization, "Bearer test-token");
});

test("sign-out swallows failures: the local session is forgotten either way", async () => {
  const { deps } = makeDeps(() => { throw new Error("offline"); });
  await assert.doesNotReject(signOutOfWorkshop(deps, SESSION));
});
