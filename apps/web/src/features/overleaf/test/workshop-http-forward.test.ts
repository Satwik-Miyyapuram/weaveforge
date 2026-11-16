import assert from "node:assert/strict";
import test from "node:test";
import { WORKSHOP_HTTP_PATH, workshopHttpForward } from "../infrastructure/workshop-http-forward";
import type { WorkshopClientDeps } from "../infrastructure/workshop-session-client";

function makeDeps(status: number, answer: unknown) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const deps: WorkshopClientDeps = {
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(answer), { status });
    },
    authHeaders: async () => ({ Authorization: "Bearer t" }),
  };
  return { deps, calls };
}

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

test("a request goes to the http route with the session, project and a base64 body", async () => {
  const { deps, calls } = makeDeps(200, { status: 200, headers: { "content-type": "application/json" }, body: btoa('{"ok":1}') });
  const res = await workshopHttpForward(deps, "S", "P")({
    method: "POST",
    url: "/project/P/compile",
    headers: { "content-type": "application/json" },
    body: bytes('{"draft":false}'),
  });
  assert.equal(calls[0]?.url, WORKSHOP_HTTP_PATH);
  assert.deepEqual(calls[0]?.body, {
    sessionId: "S",
    projectId: "P",
    method: "POST",
    url: "/project/P/compile",
    headers: { "content-type": "application/json" },
    body: btoa('{"draft":false}'),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "application/json");
  assert.equal(text(res.body), '{"ok":1}');
});

test("a body-less request sends null", async () => {
  const { deps, calls } = makeDeps(200, { status: 204, headers: {}, body: "" });
  const res = await workshopHttpForward(deps, "S", "P")({ method: "GET", url: "/user/settings", headers: {}, body: null });
  assert.equal(calls[0]?.body.body, null);
  assert.equal(res.status, 204);
  assert.equal(res.body.length, 0);
});

test("binary bytes survive both ways", async () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  const b64 = Buffer.from(all).toString("base64");
  const { deps, calls } = makeDeps(200, { status: 200, headers: {}, body: b64 });
  const res = await workshopHttpForward(deps, "S", "P")({ method: "PUT", url: "/project/P/x", headers: {}, body: all });
  assert.equal(calls[0]?.body.body, b64);
  assert.deepEqual(res.body, all);
});

test("when the route fails the IDE sees a 502 with the message", async () => {
  const { deps } = makeDeps(403, { error: "That address is not allowed." });
  const res = await workshopHttpForward(deps, "S", "P")({ method: "GET", url: "/project/Q", headers: {}, body: null });
  assert.equal(res.status, 502);
  assert.equal(text(res.body), "That address is not allowed.");
});

test("an expired session reads as Overleaf's 401", async () => {
  const { deps } = makeDeps(401, { error: "expired", expired: true });
  const res = await workshopHttpForward(deps, "S", "P")({ method: "GET", url: "/project/P", headers: {}, body: null });
  assert.equal(res.status, 401);
});
