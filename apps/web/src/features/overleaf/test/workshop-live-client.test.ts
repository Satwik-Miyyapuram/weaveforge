import assert from "node:assert/strict";
import test, { before } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import {
  emitLive,
  fetchLiveFile,
  flattenDocs,
  flattenFiles,
  loadLiveDoc,
  openLiveProject,
  sendLiveUpdate,
  takeLiveEvents,
} from "../infrastructure/workshop-live-client";
import type { WorkshopClientDeps } from "../infrastructure/workshop-session-client";

before(loadTestCore);

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

test("the tree's binary files flatten to paths too, for \\includegraphics", () => {
  assert.deepEqual(flattenFiles(ROOT), [{ id: "f1", path: "figure.png" }]);
  assert.deepEqual(flattenFiles(null), []);
});

test("open lists the project's files", async () => {
  const { deps } = makeDeps(() => ({ status: 200, body: { liveId: "L", rootFolder: ROOT } }));
  const res = await openLiveProject(deps, "S", "P");
  assert.ok(res.ok);
  assert.deepEqual(res.files, [{ id: "f1", path: "figure.png" }]);
});

test("a project file downloads as a blob, and a failure is null", async () => {
  const seen: { url: string; body: unknown; auth: unknown }[] = [];
  let status = 200;
  const deps: WorkshopClientDeps = {
    fetch: async (url, init) => {
      seen.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization });
      return new Response(status === 200 ? new Uint8Array([1, 2, 3]) : "{}", { status });
    },
    authHeaders: async (extra) => ({ Authorization: "Bearer t", ...(extra as Record<string, string>) }),
  };
  const blob = await fetchLiveFile(deps, "S", "P", "f1");
  assert.deepEqual(seen, [{ url: "/api/overleaf/workshop/file", body: { sessionId: "S", projectId: "P", fileId: "f1" }, auth: "Bearer t" }]);
  assert.equal(blob?.size, 3);
  status = 502;
  assert.equal(await fetchLiveFile(deps, "S", "P", "f1"), null);
});

test("open keeps Overleaf's join reply as sent, for the vendored IDE", async () => {
  const join = [{ project: { name: "Thesis" }, permissionsLevel: "owner", protocolVersion: 2, publicId: "p" }];
  const { deps } = makeDeps(() => ({ status: 200, body: { liveId: "L", name: "Thesis", rootFolder: ROOT, join } }));
  const res = await openLiveProject(deps, "S", "P");
  assert.ok(res.ok);
  assert.deepEqual(res.join, join);
});

test("open without a join reply gives an empty one", async () => {
  const { deps } = makeDeps(() => ({ status: 200, body: { liveId: "L", rootFolder: ROOT } }));
  const res = await openLiveProject(deps, "S", "P");
  assert.ok(res.ok);
  assert.deepEqual(res.join, []);
});

test("an emit relays the event and returns Overleaf's reply", async () => {
  const { deps, calls } = makeDeps(() => ({ status: 200, body: { reply: [null, ["a"], 7] } }));
  const res = await emitLive(deps, "L", "joinDoc", ["d1", { encodeRanges: true }]);
  assert.deepEqual(calls, [
    { url: "/api/overleaf/workshop/live/emit", body: { liveId: "L", name: "joinDoc", args: ["d1", { encodeRanges: true }] } },
  ]);
  assert.deepEqual(res, { ok: true, reply: [null, ["a"], 7] });
});

test("a refused emit says why, and a gone connection is closed", async () => {
  const { deps } = makeDeps(() => ({ status: 410, body: { error: "The live connection closed.", closed: true } }));
  assert.deepEqual(await emitLive(deps, "L", "leaveDoc", ["d1"]), {
    ok: false,
    closed: true,
    message: "The live connection closed.",
  });
});
