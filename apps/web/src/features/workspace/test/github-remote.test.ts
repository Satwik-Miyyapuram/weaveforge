/**
 * The clone's remote over GitHub's REST Git Data API: the tree without bytes,
 * one blob at a time, and commits that move the branch fast-forward only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createGithubRemote } from "../infrastructure/github-remote";

interface Call {
  method: string;
  url: string;
  body: unknown;
  auth: string | null;
}

function fakeGithub(routes: Record<string, (body: unknown) => { status?: number; json?: unknown; bytes?: Uint8Array }>) {
  const calls: Call[] = [];
  const fetchFn = async (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const headers = new Headers(init?.headers);
    calls.push({ method, url: input, body, auth: headers.get("authorization") });
    const route = routes[`${method} ${input.replace("https://api.github.com/repos/me/notes", "")}`];
    if (!route) return new Response("not found", { status: 404 });
    const out = route(body);
    if (out.bytes) return new Response(out.bytes.slice().buffer, { status: out.status ?? 200 });
    return new Response(JSON.stringify(out.json ?? {}), { status: out.status ?? 200 });
  };
  const remote = createGithubRemote({
    owner: "me",
    repo: "notes",
    branch: "main",
    fetch: fetchFn as typeof fetch,
    withToken: (call) => call("tok"),
  });
  return { remote, calls };
}

test("head reads the whole tree, files only, with no blob fetched", async () => {
  const { remote, calls } = fakeGithub({
    "GET /git/ref/heads/main": () => ({ json: { object: { sha: "c1" } } }),
    "GET /git/commits/c1": () => ({ json: { tree: { sha: "t1" } } }),
    "GET /git/trees/t1?recursive=1": () => ({
      json: {
        truncated: false,
        tree: [
          { path: "p", type: "tree", sha: "d1" },
          { path: "p/a.md", type: "blob", sha: "b1" },
          { path: "vendor/x", type: "commit", sha: "s1" },
        ],
      },
    }),
  });
  assert.deepEqual(await remote.head(), { commit: "c1", files: [{ path: "p/a.md", sha: "b1" }] });
  assert.ok(calls.every((c) => c.auth === "Bearer tok"));
  assert.ok(!calls.some((c) => c.url.includes("/git/blobs/")));
});

test("a tree too big for one answer is an error, not a partial clone", async () => {
  const { remote } = fakeGithub({
    "GET /git/ref/heads/main": () => ({ json: { object: { sha: "c1" } } }),
    "GET /git/commits/c1": () => ({ json: { tree: { sha: "t1" } } }),
    "GET /git/trees/t1?recursive=1": () => ({ json: { truncated: true, tree: [] } }),
  });
  await assert.rejects(() => remote.head(), /too large/);
});

test("blob returns the raw bytes", async () => {
  const { remote } = fakeGithub({
    "GET /git/blobs/b1": () => ({ bytes: new Uint8Array([1, 2, 3]) }),
  });
  assert.deepEqual([...(await remote.blob("b1"))], [1, 2, 3]);
});

function commitRoutes(refStatus: number) {
  return {
    "GET /git/commits/c1": () => ({ json: { tree: { sha: "t1" } } }),
    "POST /git/blobs": () => ({ status: 201, json: { sha: "nb" } }),
    "POST /git/trees": () => ({ status: 201, json: { sha: "t2" } }),
    "POST /git/commits": () => ({ status: 201, json: { sha: "c2" } }),
    "PATCH /git/refs/heads/main": () => ({ status: refStatus, json: {} }),
  };
}

test("commit builds on the parent's tree and moves the branch without force", async () => {
  const { remote, calls } = fakeGithub(commitRoutes(200));
  const outcome = await remote.commit(
    "c1",
    [
      { path: "a.md", bytes: new TextEncoder().encode("hi") },
      { path: "gone.md", bytes: null },
    ],
    "web edits",
  );
  assert.deepEqual(outcome, { kind: "pushed", commit: "c2" });
  const body = (method: string, path: string) =>
    calls.find((c) => c.method === method && c.url.endsWith(path))!.body as Record<string, unknown>;
  assert.deepEqual(body("POST", "/git/blobs"), { content: "aGk=", encoding: "base64" });
  assert.deepEqual(body("POST", "/git/trees"), {
    base_tree: "t1",
    tree: [
      { path: "a.md", mode: "100644", type: "blob", sha: "nb" },
      { path: "gone.md", mode: "100644", type: "blob", sha: null },
    ],
  });
  assert.deepEqual(body("POST", "/git/commits"), { message: "web edits", tree: "t2", parents: ["c1"] });
  assert.deepEqual(body("PATCH", "/git/refs/heads/main"), { sha: "c2", force: false });
});

test("a branch that moved on is `behind`, never forced", async () => {
  const { remote, calls } = fakeGithub(commitRoutes(422));
  const outcome = await remote.commit("c1", [{ path: "a.md", bytes: new Uint8Array([1]) }], "m");
  assert.deepEqual(outcome, { kind: "behind" });
  assert.ok(calls.every((c) => (c.body as { force?: boolean } | undefined)?.force !== true));
});

test("any other refusal is an error", async () => {
  const { remote } = fakeGithub(commitRoutes(403));
  await assert.rejects(() => remote.commit("c1", [{ path: "a.md", bytes: new Uint8Array([1]) }], "m"), /403/);
});
