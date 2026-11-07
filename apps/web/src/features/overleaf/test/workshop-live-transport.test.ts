import assert from "node:assert/strict";
import test from "node:test";
import { workshopLiveTransport } from "../infrastructure/workshop-live-transport";
import type { WorkshopClientDeps } from "../infrastructure/workshop-session-client";

function makeDeps(respond: (url: string, body: unknown) => { status: number; body: unknown }) {
  const calls: { url: string; body: unknown }[] = [];
  const deps: WorkshopClientDeps = {
    fetch: async (url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body });
      const r = respond(url, body);
      return new Response(JSON.stringify(r.body), { status: r.status });
    },
    authHeaders: async () => ({ Authorization: "Bearer t" }),
  };
  return { deps, calls };
}

test("open hands the IDE the live id and Overleaf's join args", async () => {
  const join = [null, { project: { name: "Thesis" } }];
  const { deps, calls } = makeDeps(() => ({
    status: 200,
    body: { liveId: "L1", name: "Thesis", rootDocId: null, rootFolder: [], canEdit: true, join },
  }));
  const res = await workshopLiveTransport(deps, "S", "P").open();
  assert.deepEqual(res, { ok: true, liveId: "L1", join });
  assert.deepEqual(calls[0]?.body,{ sessionId: "S", projectId: "P" });
});

test("a refused open reports why", async () => {
  const { deps } = makeDeps(() => ({ status: 401, body: { error: "Sign in to Overleaf again." } }));
  const res = await workshopLiveTransport(deps, "S", "P").open();
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && typeof res.message, "string");
});

test("emit, events and close reach their live routes with the live id", async () => {
  const { deps, calls } = makeDeps((url) =>
    url.endsWith("events")
      ? { status: 200, body: { events: [{ name: "x", args: [1] }], closed: false } }
      : { status: 200, body: { reply: [null] } },
  );
  const transport = workshopLiveTransport(deps, "S", "P");
  assert.deepEqual(await transport.emit("L1", "leaveDoc", ["d"]), { ok: true, reply: [null] });
  assert.deepEqual(await transport.events("L1"), { ok: true, events: [{ name: "x", args: [1] }], closed: false });
  await transport.close("L1");
  assert.deepEqual(
    calls.map((c) => [c.url.split("/").pop(), c.body]),
    [
      ["emit", { liveId: "L1", name: "leaveDoc", args: ["d"] }],
      ["events", { liveId: "L1" }],
      ["close", { liveId: "L1" }],
    ],
  );
});
