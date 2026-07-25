import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../route";

test("GET /api/overleaf/reports/[id]/content: 401 without a token", async () => {
  const res = await GET(
    new Request("http://localhost/api/overleaf/reports/abc/content"),
    { params: { id: "abc" } },
  );
  assert.equal(res.status, 401);
});
