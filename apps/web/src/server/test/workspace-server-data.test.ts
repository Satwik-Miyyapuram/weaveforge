import assert from "node:assert/strict";
import test from "node:test";
import {
  handleWorkspaceServerDataDelete,
  isUploadStale,
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
