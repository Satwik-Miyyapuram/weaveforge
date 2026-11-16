/**
 * Clients joining one document must reconcile it with the row's body once, not
 * once each.
 *
 * Every client used to replay its own read of the CRDT log and reconcile it with
 * the body straight away. Two reads of the log can differ (one was taken before
 * a peer's last persist), so two rebuilds of one body made different operations
 * and the merged document held the new text twice. A client whose log lagged a
 * live peer's unpersisted edits rebuilt it too, on top of the peer's.
 *
 * Now a client first syncs with the peers on the channel: one that has already
 * seeded hands over its state, and among clients that have not, only the lowest
 * client id reconciles while the others wait for its result.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";

import { markSaved, reconcileWithBody } from "../domain/seed-document";
import { RealtimeYjsProvider } from "../infrastructure/realtime-yjs-provider";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

type Handler = (msg: { payload: unknown }) => void;
const digest = (body: string) => readyCore().digestText(body);
const text = (doc: Y.Doc) => doc.getText("body").toString();
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** One broadcast topic: what a client sends reaches every other client, later. */
function bus() {
  const members: Map<string, Handler>[] = [];
  return {
    /** `joinAfterMs`: how long the channel takes to report it joined. */
    db(joinAfterMs = 0) {
      const handlers = new Map<string, Handler>();
      members.push(handlers);
      const channel = {
        topic: "realtime:crdt:vault_page:abc",
        on(_type: string, filter: { event: string }, cb: Handler) {
          handlers.set(filter.event, cb);
          return channel;
        },
        subscribe(cb?: (status: string) => void) {
          setTimeout(() => cb?.("SUBSCRIBED"), joinAfterMs);
          return channel;
        },
        send: async (msg: { event: string; payload: unknown }) => {
          for (const other of members) {
            if (other !== handlers) setTimeout(() => other.get(msg.event)?.({ payload: msg.payload }), 5);
          }
          return "ok";
        },
        unsubscribe: async () => {
          members.splice(members.indexOf(handlers), 1);
          return "ok";
        },
      };
      return { channel: () => channel, realtime: { setAuth: async () => undefined } };
    },
  };
}

/** A client that replays `log` and reconciles it with `body`, as the editor does. */
function client(net: ReturnType<typeof bus>, id: number, log: Uint8Array[], body: string, joinAfterMs = 0) {
  const doc = new Y.Doc();
  doc.clientID = id;
  let seeded = false;
  const provider = new RealtimeYjsProvider({
    doc,
    db: net.db(joinAfterMs) as never,
    crdtStore: {
      listAfter: async () => log.map((payload, i) => ({ id: i + 1, payload })),
      append: async () => ({ id: 1 }),
      countAfter: async () => 0,
    } as never,
    resourceType: "vault_page",
    resourceId: "abc",
    projectId: "p1",
    authorId: "u1",
    seed: () => {
      reconcileWithBody(doc, body, digest);
      seeded = true;
    },
  });
  return { doc, provider, isSeeded: () => seeded };
}

async function until(ok: () => boolean, label: string) {
  for (let waited = 0; !ok(); waited += 10) {
    if (waited > 8_000) assert.fail(`timed out waiting for ${label}`);
    await tick(10);
  }
}

test("sync: two clients with different reads of the log reconcile one body once", async () => {
  // A delete adds no clock: both reads share a state vector, not the text.
  const origin = new Y.Doc();
  origin.clientID = 7;
  origin.getText("body").insert(0, "abcdef");
  markSaved(origin, digest("abcdef"));
  const early = Y.encodeStateAsUpdate(origin);
  origin.getText("body").delete(1, 1);
  const late = Y.encodeStateAsUpdate(origin);

  const net = bus();
  const alice = client(net, 101, [early], "abXdef");
  const bob = client(net, 202, [late], "abXdef");
  await until(() => alice.isSeeded() && bob.isSeeded(), "both seeds");
  await tick(400);

  assert.equal(text(alice.doc), text(bob.doc), "both clients hold the same text");
  assert.equal(text(alice.doc).split("X").length - 1, 1, `one X, got ${JSON.stringify(text(alice.doc))}`);
  await Promise.all([alice.provider.destroy(), bob.provider.destroy()]);
});

test("sync: a client whose log lags a live peer takes the peer's text, not a second rebuild", async () => {
  const origin = new Y.Doc();
  origin.clientID = 7;
  origin.getText("body").insert(0, "first draft");
  markSaved(origin, digest("first draft"));
  const persisted = Y.encodeStateAsUpdate(origin);

  const net = bus();
  const alice = client(net, 101, [persisted], "first draft");
  await until(alice.isSeeded, "alice's seed");
  // Alice types and saves; the log has not caught up.
  alice.doc.getText("body").insert("first draft".length, ", second pass");
  markSaved(alice.doc, digest("first draft, second pass"));
  await tick(300);

  const bob = client(net, 50, [persisted], "first draft, second pass");
  await until(bob.isSeeded, "bob's seed");
  await tick(400);

  assert.equal(text(bob.doc), "first draft, second pass");
  assert.equal(text(alice.doc), "first draft, second pass");
  await Promise.all([alice.provider.destroy(), bob.provider.destroy()]);
});

test("sync: a solo document seeds as soon as the log is replayed", async () => {
  const doc = new Y.Doc();
  let seeded = false;
  const provider = new RealtimeYjsProvider({
    doc,
    db: {} as never,
    crdtStore: { listAfter: async () => [], append: async () => ({ id: 1 }), countAfter: async () => 0 } as never,
    resourceType: "vault_page",
    resourceId: "abc",
    projectId: null,
    authorId: "u1",
    live: false,
    seed: () => (seeded = true),
  });
  await tick(0);
  await tick(0);
  assert.equal(seeded, true);
  await provider.destroy();
});

/** Two reads of one log that rebuild one body differently, as in the first test. */
function divergentLogs() {
  const origin = new Y.Doc();
  origin.clientID = 7;
  origin.getText("body").insert(0, "abcdef");
  markSaved(origin, digest("abcdef"));
  const early = Y.encodeStateAsUpdate(origin);
  origin.getText("body").delete(1, 1);
  return { early, late: Y.encodeStateAsUpdate(origin) };
}

test("sync: a client slow to join waits for its peers, not the fallback, before it seeds", async () => {
  const { early, late } = divergentLogs();
  const net = bus();
  const alice = client(net, 101, [early], "abXdef");
  await until(alice.isSeeded, "alice's seed");
  // Bob's channel takes longer to join than the fallback: it must still hear
  // Alice's state first, not rebuild the body from its own read alone.
  const bob = client(net, 50, [late], "abXdef", 4_500);
  await until(bob.isSeeded, "bob's seed");
  await tick(400);

  assert.equal(text(bob.doc), text(alice.doc), "both clients hold the same text");
  assert.equal(text(bob.doc).split("X").length - 1, 1, `one X, got ${JSON.stringify(text(bob.doc))}`);
  await Promise.all([alice.provider.destroy(), bob.provider.destroy()]);
});

test("sync: a lower-id peer that leaves before seeding is not waited for", async () => {
  const { early } = divergentLogs();
  const net = bus();
  const carol = client(net, 50, [early], "abXdef");
  const alice = client(net, 101, [early], "abXdef");
  const started = Date.now();
  await tick(100);
  assert.equal(carol.isSeeded(), false, "carol leaves inside the window, unseeded");
  await carol.provider.destroy();
  await until(alice.isSeeded, "alice's seed");
  assert.ok(
    Date.now() - started < 2_000,
    `alice seeded after the window, not the fallback (${Date.now() - started} ms)`,
  );
  assert.equal(text(alice.doc), "abXdef");
  await alice.provider.destroy();
});
