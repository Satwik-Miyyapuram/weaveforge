import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DELETE } from "../route";

const ENV_NAMES = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_DATA_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const saved = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of ENV_NAMES) {
    const value = saved.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function deleteRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/workspaces/w1/server-data?epoch=3", {
    method: "DELETE",
    headers,
  });
}

// Without a bearer the handler refuses before any network call, so the
// Supabase and PostgREST URLs only need to be configured, not reachable.
test("DELETE /api/workspaces/[id]/server-data: no bearer is 401 and writes nothing", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://auth.invalid";
  process.env.NEXT_PUBLIC_DATA_URL = "http://data.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
  const res = await DELETE(deleteRequest(), params("w1"));
  assert.equal(res.status, 401);
});

test("DELETE /api/workspaces/[id]/server-data: fails closed when the auth config is missing", async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_DATA_URL = "http://data.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
  await assert.rejects(
    () => DELETE(deleteRequest({ authorization: "Bearer t" }), params("w1")),
    /NEXT_PUBLIC_SUPABASE_URL is not configured/,
  );
});

test("DELETE /api/workspaces/[id]/server-data: a malformed workspace id in the path is 400", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://auth.invalid";
  process.env.NEXT_PUBLIC_DATA_URL = "http://data.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
  // Next passes the path segment already decoded.
  for (const bad of ["w 1", "w.1", "../x", "w:1"]) {
    const res = await DELETE(deleteRequest({ authorization: "Bearer t" }), params(bad));
    assert.equal(res.status, 400, bad);
  }
});
