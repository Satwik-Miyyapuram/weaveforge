import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "../route";

// The MCP endpoint deliberately fails closed until pairing exists: 404 when the
// generated registry disables it, 503 (pairing required) when enabled. Either
// way it must never 200 or expose callable tools, and must not be cached.

test("GET /api/mcp: fails closed (404 or 503), never cached", async () => {
  const res = await GET();
  assert.ok([404, 503].includes(res.status), `unexpected status ${res.status}`);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  assert.ok((await res.json()).error);
});

test("POST /api/mcp: fails closed (404 or 503)", async () => {
  const res = await POST();
  assert.ok([404, 503].includes(res.status), `unexpected status ${res.status}`);
});
