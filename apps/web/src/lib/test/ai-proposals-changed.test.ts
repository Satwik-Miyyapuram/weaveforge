/**
 * A change to the review queue clears the pending memo before anyone hears
 * about it (xstate-08), so every listener re-reads the queue rather than the
 * one that happened to clear it first. One event name, one place (xstate-13).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { AI_PROPOSALS_CHANGED_EVENT, announceAiProposalsChanged } from "@/lib/ai-proposals-changed";

test("the memo is forgotten before the event fires", () => {
  const order: string[] = [];
  const g = globalThis as Record<string, unknown>;
  const saved = g.window;
  g.window = { dispatchEvent: (e: Event) => void order.push(`event:${e.type}`) };
  try {
    announceAiProposalsChanged({ forgetPending: () => void order.push("forget") });
  } finally {
    g.window = saved;
  }
  assert.deepEqual(order, ["forget", `event:${AI_PROPOSALS_CHANGED_EVENT}`]);
  assert.equal(AI_PROPOSALS_CHANGED_EVENT, "ai-proposals-changed");
});

test("with no window the memo is still forgotten", () => {
  let forgot = false;
  announceAiProposalsChanged({ forgetPending: () => void (forgot = true) });
  assert.equal(forgot, true);
});
