import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../route";

const call = (token: string, file: string) =>
  GET(new Request(`http://localhost/api/plan/feed/${token}/${file}`), { params: { token, file } });

test("a file the feed does not serve is a 404, before the token is looked at", async () => {
  const response = await call("wf_anything", "passwords.txt");
  assert.equal(response.status, 404);
});

test("a malformed token is a 404, not a 401, so calendar apps stop polling it", async () => {
  for (const file of ["deadlines.ics", "widget.json"]) {
    const response = await call("not-a-token", file);
    assert.equal(response.status, 404, file);
    const body = (await response.json()) as { error: string };
    assert.equal(body.error, "Not found.");
  }
});
