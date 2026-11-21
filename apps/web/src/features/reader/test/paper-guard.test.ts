/**
 * A fetch, a free-copy search or a page removal that finishes after the
 * person opened another paper must not write into that paper's view (P2-167).
 * The pane checks a guard taken when the work started after each await.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { paperGuard } from "../ui/paper-guard";

test("the guard holds while the same paper is open", () => {
  const ref = { current: "p1" as string | null };
  const stillOpen = paperGuard(ref, "p1");
  assert.equal(stillOpen(), true);
});

test("the guard fails once another paper is open", () => {
  const ref = { current: "p1" as string | null };
  const stillOpen = paperGuard(ref, "p1");
  ref.current = "p2";
  assert.equal(stillOpen(), false);
});

test("the guard fails when no paper is open", () => {
  const ref = { current: "p1" as string | null };
  const stillOpen = paperGuard(ref, "p1");
  ref.current = null;
  assert.equal(stillOpen(), false);
});
