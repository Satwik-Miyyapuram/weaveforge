import assert from "node:assert/strict";
import test from "node:test";
import {
  flattenDocs,
  loadLiveDoc,
  openLiveProject,
  sendLiveUpdate,
  takeLiveEvents,
} from "../infrastructure/workshop-live-client";
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
    authHeaders: async (extra) => ({ Authorization: "Bearer t", ...(extra as Record<string, string>) }),
  };
  return { deps, calls };
}

const ROOT = [
  {
    _id: "root",
    name: "rootFolder",
    docs: [{ _id: "d1", name: "main.tex" }],
    fileRefs: [{ _id: "f1", name: "figure.png" }],
    folders: [{ _id: "s", name: "chapters", docs: [{ _id: "d2", name: "intro.tex" }], folders: [] }],
  },
];

test("the tree flattens to doc paths without the root name or binary files", () => {
  assert.deepEqual(flattenDocs(ROOT), [
    { id: "d2", path: "chapters/intro.tex" },
    { id: "d1", path: "main.tex" },
  ]);
  assert.deepEqual(flattenDocs(null), []);
});

test("open sends the session and project and reads the joined project", async () => {
  const { deps, calls } = makeDeps(() => ({
    status: 200,
    body: { liveId: "L", name: "Thesis", rootDocId: "d1", rootFolder: ROOT, permissionsLevel: "readOnly" },
  }));
  const res = await openLiveProject(deps, "S", "P");
  assert.deepEqual(calls, [{ url: "/api/overleaf/workshop/live/open", body: { sessionId: "S", projectId: "P" } }]);
  assert.ok(res.ok);
  assert.equal(res.liveId, "L");
  assert.equal(res.rootDocId, "d1");
  assert.equal(res.docs.length, 2);
  assert.equal(res.canEdit, false);
});

test("an expired session on open says so", async () => {
  const { deps } = makeDeps(() => ({ status: 401, body: { error: "Sign in again.", expired: true } }));
  assert.deepEqual(await openLiveProject(deps, "S", "P"), { ok: false, expired: true, message: "Sign in again." });
});

test("a doc's lines join into its text", async () => {
  const { deps } = makeDeps(() => ({ status: 200, body: { lines: ["a", "é"], version: 7 } }));
  assert.deepEqual(await loadLiveDoc(deps, "L", "d1"), { ok: true, text: "a\né", version: 7 });
});

test("updates post the op and version; a gone connection is closed", async () => {
  const { deps, calls } = makeDeps(() => ({ status: 410, body: { error: "The live connection closed.", closed: true } }));
  const res = await sendLiveUpdate(deps, "L", "d1", [{ p: 0, i: "x" }], 3);
  assert.deepEqual(calls[0]?.body, { liveId: "L", docId: "d1", op: [{ p: 0, i: "x" }], version: 3 });
  assert.deepEqual(res, { ok: false, closed: true, message: "The live connection closed." });
});

test("events keep only named events", async () => {
  const { deps } = makeDeps(() => ({
    status: 200,
    body: { events: [{ name: "otUpdateApplied", args: [{ v: 1 }] }, { nope: 1 }, { name: "resync" }], closed: false },
  }));
  assert.deepEqual(await takeLiveEvents(deps, "L"), {
    ok: true,
    events: [
      { name: "otUpdateApplied", args: [{ v: 1 }] },
      { name: "resync", args: [] },
    ],
    closed: false,
  });
});
