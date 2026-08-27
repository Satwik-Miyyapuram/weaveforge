import assert from "node:assert/strict";
import test from "node:test";

import { LOCAL_USER_ID } from "@weaveforge/core";

import { routeSdkRequest, type SdkQuery } from "../src/local-sdk-api";
import type { LocalApiRequest } from "../src/local-api";

interface Asked {
  sql: string;
  params: unknown[];
}

/** A database that answers whatever it is told to, and remembers the asking. */
function db(answers: unknown[][] = []): { query: SdkQuery; asked: Asked[] } {
  const asked: Asked[] = [];
  const query: SdkQuery = async (sql, params) => {
    asked.push({ sql, params });
    return { ok: true, value: answers[asked.length - 1] ?? [] };
  };
  return { query, asked };
}

function ask(request: Partial<LocalApiRequest> & { url: string }): {
  request: LocalApiRequest;
  url: URL;
  path: string;
} {
  const full: LocalApiRequest = { method: "GET", ...request };
  const url = new URL(full.url, "http://127.0.0.1");
  return { request: full, url, path: url.pathname };
}

async function route(query: SdkQuery, request: Partial<LocalApiRequest> & { url: string }) {
  const { request: full, url, path } = ask(request);
  const answer = await routeSdkRequest(query, full, url, path);
  assert.ok(answer, `nothing answered ${path}`);
  return { status: answer.status, body: JSON.parse(answer.body || "{}") };
}

test("a path that is not the SDK's is left for the rest of the API", async () => {
  const { query } = db();
  const { request, url, path } = ask({ url: "/vault/notes/a.md" });
  assert.equal(await routeSdkRequest(query, request, url, path), null);
});

test("there is one user here, and it is the local one", async () => {
  const { query, asked } = db();
  const answer = await route(query, { url: "/api/sdk/whoami" });
  assert.equal(answer.status, 200);
  assert.equal(answer.body.userId, LOCAL_USER_ID);
  // No round trip: the answer is a constant, not a row.
  assert.equal(asked.length, 0);
});

test("a project is found by name", async () => {
  const { query, asked } = db([[{ id: "proj-1" }]]);
  const answer = await route(query, { url: "/api/sdk/projects?name=Offline%20Trial" });
  assert.equal(answer.body.projectId, "proj-1");
  assert.deepEqual(asked[0]?.params, ["Offline Trial"]);
});

test("a project nobody named is refused rather than searched for", async () => {
  const { query, asked } = db();
  assert.equal((await route(query, { url: "/api/sdk/projects" })).status, 400);
  assert.equal(asked.length, 0);
});

test("saving an experiment writes the local user and casts the JSON columns", async () => {
  const { query, asked } = db([[{ id: "exp-1" }]]);
  const answer = await route(query, {
    method: "POST",
    url: "/api/sdk/experiments",
    body: JSON.stringify({
      id: "exp-1",
      name: "warm start",
      config: { lr: 0.01 },
      status: "running",
    }),
  });
  assert.equal(answer.status, 200);
  const { sql, params } = asked[0]!;
  assert.match(sql, /insert into experiments \(user_id, id, name, status, config\)/);
  assert.match(sql, /\$5::jsonb/);
  assert.match(sql, /on conflict \(id\) do update set user_id = excluded\.user_id, name = excluded\.name/);
  assert.equal(params[0], LOCAL_USER_ID);
  assert.equal(params[4], '{"lr":0.01}');
});

test("a column nobody declared is dropped, not interpolated", async () => {
  const { query, asked } = db([[]]);
  await route(query, {
    method: "POST",
    url: "/api/sdk/experiments",
    body: JSON.stringify({ id: "exp-1", "name = 1, user_id": "x" }),
  });
  assert.equal(asked[0]!.sql.includes("user_id, id)"), true);
});

test("an experiment with no id is refused", async () => {
  const { query } = db();
  const answer = await route(query, {
    method: "POST",
    url: "/api/sdk/experiments",
    body: JSON.stringify({ name: "nameless" }),
  });
  assert.equal(answer.status, 400);
});

test("deleting an experiment that was never there says so", async () => {
  const { query } = db([[]]);
  const answer = await route(query, { method: "DELETE", url: "/api/sdk/experiments?id=exp-9" });
  assert.equal(answer.status, 404);
});

test("metric points go in as one statement, and the run is marked running", async () => {
  const { query, asked } = db([[], []]);
  const answer = await route(query, {
    method: "POST",
    url: "/api/sdk/metrics",
    body: JSON.stringify({
      points: [
        { experiment_id: "exp-1", metric: "loss", step: 0, value: 1.5, wall_time: "2026-08-27T00:00:00Z" },
        { experiment_id: "exp-1", metric: "loss", step: 1, value: 1.25 },
      ],
    }),
  });
  assert.equal(answer.status, 200);
  assert.equal(answer.body.stored, 2);
  assert.equal(asked.length, 2);
  assert.match(asked[0]!.sql, /values \(\$1, \$2, \$3, \$4, \$5, \$6\), \(\$1, \$7, \$8, \$9, \$10, \$11\)$/);
  assert.equal(asked[0]!.params[0], LOCAL_USER_ID);
  assert.equal(asked[0]!.params[5], "2026-08-27T00:00:00Z");
  assert.equal(asked[0]!.params[10], null);
  assert.match(asked[1]!.sql, /update experiments set started_at = now\(\)/);
  assert.deepEqual(asked[1]!.params, ["exp-1"]);
});

test("a point whose value is not a number is refused before anything is written", async () => {
  const { query, asked } = db();
  const answer = await route(query, {
    method: "POST",
    url: "/api/sdk/metrics",
    body: JSON.stringify({ points: [{ experiment_id: "exp-1", metric: "loss", value: "later" }] }),
  });
  assert.equal(answer.status, 400);
  assert.equal(asked.length, 0);
});

test("an empty flush is not a statement", async () => {
  const { query, asked } = db();
  assert.equal((await route(query, { method: "POST", url: "/api/sdk/metrics", body: '{"points":[]}' })).status, 200);
  assert.equal(asked.length, 0);
});

test("a route the SDK does not have is a 404, not a fall-through", async () => {
  const { query } = db();
  assert.equal((await route(query, { url: "/api/sdk/artifacts" })).status, 404);
});
