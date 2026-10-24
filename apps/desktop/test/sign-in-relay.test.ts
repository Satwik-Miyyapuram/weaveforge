import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createSignInInbox, sendWhenLoaded } from "../src/sign-in-relay";

/** Just the part of `WebContents` the relay touches. */
function fakeContents(loading: boolean) {
  const sent: unknown[][] = [];
  const events = new EventEmitter();
  return {
    sent,
    finishLoad: () => {
      loading = false;
      events.emit("did-finish-load");
    },
    contents: {
      isLoading: () => loading,
      once: (name: "did-finish-load", fn: () => void) => events.once(name, fn),
      send: (channel: string, ...args: unknown[]) => sent.push([channel, ...args]),
    },
  };
}

test("a sign-in for a page still loading waits for the load (38-07)", () => {
  const page = fakeContents(true);
  sendWhenLoaded(page.contents, "auth:sign-in", "?code=1");
  assert.deepEqual(page.sent, []);
  page.finishLoad();
  assert.deepEqual(page.sent, [["auth:sign-in", "?code=1"]]);
});

test("a sign-in for a loaded page is sent at once (38-07)", () => {
  const page = fakeContents(false);
  sendWhenLoaded(page.contents, "auth:sign-in", "?code=1");
  assert.deepEqual(page.sent, [["auth:sign-in", "?code=1"]]);
});

test("a sign-in that arrives before anyone listens is handed to the first listener (38-07)", () => {
  const inbox = createSignInInbox();
  inbox.deliver("?code=early");
  const got: string[] = [];
  inbox.subscribe((q) => got.push(q));
  assert.deepEqual(got, ["?code=early"]);
  // Handed over once: a second listener does not finish the same sign-in again.
  const again: string[] = [];
  inbox.subscribe((q) => again.push(q));
  assert.deepEqual(again, []);
});

test("a listening page gets each sign-in as it arrives, and stops after unsubscribing (38-07)", () => {
  const inbox = createSignInInbox();
  const got: string[] = [];
  const stop = inbox.subscribe((q) => got.push(q));
  inbox.deliver("?code=1");
  stop();
  inbox.deliver("?code=2");
  assert.deepEqual(got, ["?code=1"]);
  // With nobody listening the newest is kept for whoever subscribes next.
  inbox.subscribe((q) => got.push(q));
  assert.deepEqual(got, ["?code=1", "?code=2"]);
});
