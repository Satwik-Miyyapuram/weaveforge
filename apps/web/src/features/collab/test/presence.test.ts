/**
 * Who else is in a document: one entry per person, never yourself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { readyCore } from "@/lib/rust-core";
const peersFromStates: ReturnType<typeof readyCore>["peersFromStates"] = (...a) => readyCore().peersFromStates(...a);
const samePeers: ReturnType<typeof readyCore>["samePeers"] = (...a) => readyCore().samePeers(...a);
import { peersFor, publishPeers, subscribePeers } from "../application/presence-store";

const user = (id: string | undefined, name: string, color = "#000") => ({ user: { id, name, color } });

test("own client and own other sessions are left out", () => {
  const states = new Map<number, unknown>([
    [1, user("me", "Me")],
    [2, user("me", "Me")], // same account, another window or device
    [3, user("ann", "Ann")],
  ]);
  assert.deepEqual(peersFromStates(states, { clientId: 1, authorId: "me" }), [
    { key: "ann", name: "Ann", color: "#000" },
  ]);
});

test("one person in two windows shows once", () => {
  const states = new Map<number, unknown>([
    [3, user("ann", "Ann", "#111")],
    [4, user("ann", "Ann", "#111")],
    [5, user("bob", "Bob", "#222")],
  ]);
  assert.deepEqual(
    peersFromStates(states, { clientId: 1, authorId: "me" }).map((p) => p.name),
    ["Ann", "Bob"],
  );
});

test("two people sharing a name stay two", () => {
  const states = new Map<number, unknown>([
    [3, user("a1", "Alex")],
    [4, user("a2", "Alex")],
  ]);
  assert.equal(peersFromStates(states, { clientId: 1, authorId: "me" }).length, 2);
});

test("a client with no id (older build) is keyed by client id; empty state is skipped", () => {
  const states = new Map<number, unknown>([
    [3, user(undefined, "", "")],
    [4, {}],
  ]);
  assert.deepEqual(peersFromStates(states, { clientId: 1, authorId: "me" }), [
    { key: "client:3", name: "Someone", color: "var(--accent)" },
  ]);
});

test("store: publish, read, clear, and listeners fire", () => {
  let calls = 0;
  const stop = subscribePeers(() => calls++);
  const ann = [{ key: "ann", name: "Ann", color: "#111" }];
  publishPeers("note:1", ann);
  assert.equal(peersFor("note:1"), ann);
  assert.deepEqual(peersFor("note:2"), []);
  assert.equal(peersFor("note:2"), peersFor("note:2"), "empty result is stable");
  publishPeers("note:1", []);
  assert.deepEqual(peersFor("note:1"), []);
  assert.equal(calls, 2);
  stop();
  publishPeers("note:1", ann);
  assert.equal(calls, 2);
  publishPeers("note:1", []);
});

test("samePeers: a remote cursor move (same people) is no change", () => {
  const a = [{ key: "ann", name: "Ann", color: "#111" }];
  assert.equal(samePeers(a, [{ ...a[0]! }]), true);
  assert.equal(samePeers(a, []), false);
  assert.equal(samePeers(a, [{ ...a[0]!, name: "Ann B" }]), false);
});
