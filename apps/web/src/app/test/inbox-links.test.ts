/** The sidebar's Inbox group: things other people or the AI sent you (D-04). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inboxLinks, type InboxInput } from "../inbox-links";

const base: InboxInput = { canSupervise: false, pendingProposals: 0, local: false };
const labels = (input: Partial<InboxInput> = {}) => inboxLinks({ ...base, ...input }).map((l) => l.label);

test("a student sees AI suggestions and Shared with you", () => {
  assert.deepEqual(labels(), ["AI suggestions", "Shared with you"]);
});

test("a supervisor also sees Supervision", () => {
  assert.deepEqual(labels({ canSupervise: true }), ["AI suggestions", "Shared with you", "Supervision"]);
});

test("without an account only AI suggestions is left: sharing needs the server", () => {
  assert.deepEqual(labels({ local: true, canSupervise: true }), ["AI suggestions"]);
});

test("AI suggestions carries the pending count, and none when nothing waits", () => {
  const ai = (n: number) => inboxLinks({ ...base, pendingProposals: n })[0];
  assert.equal(ai(4)?.badge, 4);
  assert.equal(ai(0)?.badge, undefined);
});

test("every Inbox entry is a route", () => {
  for (const l of inboxLinks({ canSupervise: true, pendingProposals: 1, local: false })) {
    assert.match(l.path, /^\/[a-z-]+$/);
  }
});
