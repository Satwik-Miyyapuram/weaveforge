import assert from "node:assert/strict";
import test from "node:test";
import {
  checkWorkspaceUpload,
  createTombstoneReader,
  handleWorkspaceServerDataDelete,
  isUploadStale,
  isWorkspaceId,
  type ServerDataDeps,
} from "../workspace-server-data";

const USER = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "w1";

function deps(overrides: Partial<ServerDataDeps> = {}) {
  const calls: Array<{ userId: string; workspaceId: string; epoch: number; bearer: string }> = [];
  const value: ServerDataDeps = {
    authenticate: async (bearer) => (bearer === "good-token" ? { userId: USER } : null),
    recordTombstone: async (call) => {
      calls.push(call);
    },
    ...overrides,
  };
  return { value, calls };
}

function request(query: string, headers: Record<string, string> = {}) {
  return new Request(`https://app.test/api/workspaces/${WORKSPACE}/server-data${query}`, {
    method: "DELETE",
    headers,
  });
}

const AUTH = { authorization: "Bearer good-token" };

test("DELETE without a bearer is 401 and writes nothing", async () => {
  const { value, calls } = deps();
  const res = await handleWorkspaceServerDataDelete(request("?epoch=3"), WORKSPACE, value);
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test("DELETE with a malformed Authorization header is 401", async () => {
  const { value, calls } = deps();
  const res = await handleWorkspaceServerDataDelete(request("?epoch=3", { authorization: "Basic x" }), WORKSPACE, value);
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test("DELETE with a token the auth service rejects is 401 and writes nothing", async () => {
  const { value, calls } = deps();
  const res = await handleWorkspaceServerDataDelete(
    request("?epoch=3", { authorization: "Bearer bad-token" }),
    WORKSPACE,
    value,
  );
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test("DELETE without an epoch is 400 even when authenticated", async () => {
  const { value, calls } = deps();
  const res = await handleWorkspaceServerDataDelete(request("", AUTH), WORKSPACE, value);
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test("DELETE with a non-integer or negative epoch is 400", async () => {
  const { value } = deps();
  for (const q of ["?epoch=abc", "?epoch=-1", "?epoch=1.5"]) {
    const res = await handleWorkspaceServerDataDelete(request(q, AUTH), WORKSPACE, value);
    assert.equal(res.status, 400, q);
  }
});

test("DELETE with a valid token records the tombstone for the caller and returns 200", async () => {
  const { value, calls } = deps();
  const res = await handleWorkspaceServerDataDelete(request("?epoch=7", AUTH), WORKSPACE, value);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, workspaceId: WORKSPACE, epoch: 7 });
  assert.deepEqual(calls, [{ userId: USER, workspaceId: WORKSPACE, epoch: 7, bearer: "good-token" }]);
});

test("a store failure is 500 and reports no success", async () => {
  const { value } = deps({
    recordTombstone: async () => {
      throw new Error("postgrest down");
    },
  });
  const res = await handleWorkspaceServerDataDelete(request("?epoch=7", AUTH), WORKSPACE, value);
  assert.equal(res.status, 500);
});

test("uploads below the tombstone epoch are stale; equal or newer are accepted", () => {
  assert.equal(isUploadStale(null, 0), false);
  assert.equal(isUploadStale(5, 4), true);
  assert.equal(isUploadStale(5, 5), false);
  assert.equal(isUploadStale(5, 6), false);
});

test("a workspace id is letters, digits, underscore or dash, as the shell's id rule", () => {
  for (const id of ["w1", "A_b-9", "0123456789abcdef0123456789abcdef"]) {
    assert.equal(isWorkspaceId(id), true, id);
  }
  for (const id of ["", "w 1", "w.1", "w/1", "../x", "w%2F1", "w:1", "w\n1", "é"]) {
    assert.equal(isWorkspaceId(id), false, JSON.stringify(id));
  }
});

test("DELETE with a bad workspace id is 400 and writes nothing, even when authenticated", async () => {
  for (const bad of ["w 1", "w.1", "../x", "w%2F1"]) {
    const { value, calls } = deps();
    const res = await handleWorkspaceServerDataDelete(request("?epoch=3", AUTH), bad, value);
    assert.equal(res.status, 400, bad);
    assert.equal(calls.length, 0, bad);
  }
});

test("an upload whose epoch is below the workspace tombstone is rejected with 409", async () => {
  const read = async () => 5;
  const res = await checkWorkspaceUpload({ workspaceId: WORKSPACE, epoch: 4, bearer: "good-token", readTombstoneEpoch: read });
  assert.equal(res?.status, 409);
});

test("an upload at or above the tombstone epoch, or with no tombstone, is allowed", async () => {
  const at = await checkWorkspaceUpload({ workspaceId: WORKSPACE, epoch: 5, bearer: "t", readTombstoneEpoch: async () => 5 });
  const above = await checkWorkspaceUpload({ workspaceId: WORKSPACE, epoch: 6, bearer: "t", readTombstoneEpoch: async () => 5 });
  const none = await checkWorkspaceUpload({ workspaceId: WORKSPACE, epoch: 0, bearer: "t", readTombstoneEpoch: async () => null });
  assert.equal(at, null);
  assert.equal(above, null);
  assert.equal(none, null);
});

test("an upload is refused with 500 when the tombstone cannot be read (fails closed)", async () => {
  const res = await checkWorkspaceUpload({
    workspaceId: WORKSPACE,
    epoch: 9,
    bearer: "t",
    readTombstoneEpoch: async () => {
      throw new Error("postgrest down");
    },
  });
  assert.equal(res?.status, 500);
});

test("the tombstone reader reads the caller's own row and returns its epoch or null", async () => {
  const realFetch = globalThis.fetch;
  const seen: Array<{ url: string; auth: string | null }> = [];
  let body = '[{"epoch":5}]';
  let status = 200;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
    return new Response(body, { status });
  }) as typeof fetch;
  try {
    const read = createTombstoneReader({ dataUrl: "https://data.test/", anonKey: "anon" });
    assert.equal(await read({ workspaceId: "w1", bearer: "good-token" }), 5);
    assert.equal(seen[0]?.url, "https://data.test/workspace_tombstones?select=epoch&workspace_id=eq.w1");
    assert.equal(seen[0]?.auth, "Bearer good-token");

    body = "[]";
    assert.equal(await read({ workspaceId: "w1", bearer: "good-token" }), null);

    status = 500;
    await assert.rejects(() => read({ workspaceId: "w1", bearer: "good-token" }));
  } finally {
    globalThis.fetch = realFetch;
  }
});
