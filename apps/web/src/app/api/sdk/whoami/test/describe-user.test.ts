import { test } from "node:test";
import assert from "node:assert/strict";
import { describeSdkUser } from "../describe-user";
import type { ApiCaller } from "../../_shared";

function fakeDb(result: { data: unknown; error: unknown }) {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => result,
  };
  return { from: () => q } as unknown as ApiCaller["db"];
}

test("describeSdkUser: returns the profile fields", async () => {
  const db = fakeDb({ data: { email: "a@b.c", full_name: "A" }, error: null });
  assert.deepEqual(await describeSdkUser(db, "u1"), { userId: "u1", email: "a@b.c", fullName: "A" });
});

test("describeSdkUser: no profile row is nulls, not an error", async () => {
  const db = fakeDb({ data: null, error: null });
  assert.deepEqual(await describeSdkUser(db, "u1"), { userId: "u1", email: null, fullName: null });
});

test("describeSdkUser: a profile read error keeps userId and is logged (14-13)", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const db = fakeDb({ data: null, error: { code: "57014", message: "timeout" } });
  assert.deepEqual(await describeSdkUser(db, "u1"), { userId: "u1", email: null, fullName: null });
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0]!.arguments[0]), /sdk-whoami/);
});
