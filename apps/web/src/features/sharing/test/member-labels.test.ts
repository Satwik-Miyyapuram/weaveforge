import { test } from "node:test";
import assert from "node:assert/strict";
import type { Member } from "@weaveforge/core";

import { buildMemberNameMap } from "../application/member-labels";

const member = (id: string, fullName?: string, email?: string) =>
  ({ id, fullName, email }) as unknown as Member;

test("a member is named by full name first", () => {
  assert.equal(buildMemberNameMap([member("a", "Ada", "ada@x.org")]).get("a"), "Ada");
});

test("a member with no name is named by email", () => {
  assert.equal(buildMemberNameMap([member("b", undefined, "b@x.org")]).get("b"), "b@x.org");
});

test("a member with neither is 'Member', and an unknown id is absent", () => {
  const map = buildMemberNameMap([member("c")]);
  assert.equal(map.get("c"), "Member");
  assert.equal(map.has("z"), false);
});
