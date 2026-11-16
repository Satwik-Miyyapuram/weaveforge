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
import { Awareness } from "y-protocols/awareness";

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

/** How one client's socket behaves. */
interface Link {
  /** How long a channel takes to report it joined. */
  joinAfterMs?: number;
  /** How long the provider waits for a join before it gives up and retries. */
  joinTimeoutMs?: number;
  /** The token step before each join; one that never settles stalls the join. */
  setAuth?: () => Promise<unknown>;
  /** Leaving never finishes: the channel is off the topic, but the promise hangs. */
  hangUnsubscribe?: boolean;
  /**
   * Leaving takes this long, the channel's own leave timeout. Until it ends
   * `channel()` hands back the leaving channel, whose `subscribe()` does
   * nothing, as supabase-js does while a channel is still registered.
   */
  leaveMs?: number;
  /** This many `onConnected` calls throw. */
  connectedThrows?: number;
  /** This many `channel()` calls throw before one succeeds. */
  channelThrows?: number;
  /** Every channel errors right after it joins. */
  failOnJoin?: boolean;
  /** Give the client an awareness, as the editor does. */
  awareness?: boolean;
}

/**
 * One broadcast topic: what a joined channel sends reaches every other joined
 * channel, later. Each `channel()` is a fresh channel, as supabase-js hands out
 * once the last one on the topic has left.
 */
function bus() {
  const members: Map<string, Handler>[] = [];
  const leave = (handlers: Map<string, Handler>) => {
    const at = members.indexOf(handlers);
    if (at >= 0) members.splice(at, 1);
  };
  return {
    db(link: Link = {}) {
      const state = { joins: 0, joinedAt: [] as number[], fail: () => {} };
      let throws = link.channelThrows ?? 0;
      let leaving: unknown = null;
      const db = {
        channel: () => {
          if (leaving) return leaving;
          if (throws > 0) {
            throws -= 1;
            throw new Error("socket not ready");
          }
          const handlers = new Map<string, Handler>();
          let left = false;
          const channel = {
            topic: "realtime:crdt:vault_page:abc",
            timeout: link.leaveMs,
            on(_type: string, filter: { event: string }, cb: Handler) {
              handlers.set(filter.event, cb);
              return channel;
            },
            subscribe(cb?: (status: string) => void) {
              setTimeout(() => {
                // A channel that left before its join came back stays out.
                if (left) return;
                members.push(handlers);
                state.joins += 1;
                state.joinedAt.push(Date.now());
                cb?.("SUBSCRIBED");
                if (link.failOnJoin) setTimeout(() => state.fail(), 0);
              }, link.joinAfterMs ?? 0);
              state.fail = () => {
                leave(handlers);
                cb?.("CHANNEL_ERROR");
              };
              return channel;
            },
            send: async (msg: { event: string; payload: unknown }) => {
              if (!members.includes(handlers)) return "error";
              for (const other of members) {
                if (other !== handlers) setTimeout(() => other.get(msg.event)?.({ payload: msg.payload }), 5);
              }
              return "ok";
            },
            unsubscribe: () => {
              left = true;
              leave(handlers);
              if (link.leaveMs !== undefined) {
                leaving = channel;
                return new Promise<string>((resolve) =>
                  setTimeout(() => {
                    leaving = null;
                    resolve("ok");
                  }, link.leaveMs),
                );
              }
              return link.hangUnsubscribe ? new Promise<string>(() => {}) : Promise.resolve("ok");
            },
          };
          return channel;
        },
        // As supabase-js: leave, then drop the channel once the leave settles.
        removeChannel: (channel: { unsubscribe: () => Promise<string> }) => channel.unsubscribe(),
        realtime: { setAuth: link.setAuth ?? (async () => undefined) },
      };
      return { db, state };
    },
  };
}

/** A client that replays `log` and reconciles it with `body`, as the editor does. */
function client(net: ReturnType<typeof bus>, id: number, log: Uint8Array[], body: string, link: Link = {}) {
  const doc = new Y.Doc();
  doc.clientID = id;
  let seeded = false;
  let connectedThrows = link.connectedThrows ?? 0;
  const errors: string[] = [];
  const socket = net.db(link);
  const awareness = link.awareness ? new Awareness(doc) : undefined;
  const provider = new RealtimeYjsProvider({
    doc,
    awareness,
    db: socket.db as never,
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
    onConnected: () => {
      if (connectedThrows > 0) {
        connectedThrows -= 1;
        throw new Error("listener failed");
      }
    },
    onError: (stage, detail) => errors.push(`${stage}: ${detail}`),
    timing: { joinTimeoutMs: link.joinTimeoutMs ?? 300, rejoinBaseMs: 50, rejoinMaxMs: 200 },
  });
  return { doc, provider, awareness, errors, isSeeded: () => seeded, socket: socket.state };
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
  const bob = client(net, 50, [late], "abXdef", { joinAfterMs: 4_500, joinTimeoutMs: 8_000 });
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

/** A log that already holds `body`: seeding it changes nothing. */
function savedLog(body: string) {
  const origin = new Y.Doc();
  origin.clientID = 7;
  origin.getText("body").insert(0, body);
  markSaved(origin, digest(body));
  return Y.encodeStateAsUpdate(origin);
}

test("sync: a join that never completes seeds locally, keeps retrying, and merges once it gets through", async () => {
  const log = savedLog("abcdef");
  const net = bus();
  const alice = client(net, 101, [log], "abcdef");
  let open = false;
  const bob = client(net, 202, [log], "abcdef", {
    setAuth: () => (open ? Promise.resolve() : new Promise(() => {})),
  });
  await until(alice.isSeeded, "alice's seed");
  // Bob's token never comes: past the join timeout the editor still works.
  await until(bob.isSeeded, "bob's local seed");
  assert.equal(text(bob.doc), "abcdef");
  bob.doc.getText("body").insert(6, "!");
  alice.doc.getText("body").insert(0, ">");
  await tick(500);
  assert.equal(bob.socket.joins, 0, "still not joined");

  open = true;
  await until(() => bob.socket.joins > 0, "bob's join after the retry");
  await until(() => text(alice.doc) === text(bob.doc), "the merge");
  assert.equal(text(bob.doc), ">abcdef!", "each side's edit once, no second body");
  await Promise.all([alice.provider.destroy(), bob.provider.destroy()]);
});

test("sync: a channel that errors after joining rejoins and catches up", async () => {
  const log = savedLog("abcdef");
  const net = bus();
  const alice = client(net, 101, [log], "abcdef");
  const bob = client(net, 202, [log], "abcdef");
  await until(() => alice.isSeeded() && bob.isSeeded() && bob.socket.joins === 1, "both joined");

  bob.socket.fail();
  alice.doc.getText("body").insert(0, "1");
  await tick(30);
  assert.equal(text(bob.doc), "abcdef", "bob is off the topic and missed it");

  await until(() => bob.socket.joins === 2, "bob's rejoin");
  await until(() => text(bob.doc) === "1abcdef", "bob catching up");
  bob.doc.getText("body").insert(7, "2");
  await until(() => text(alice.doc) === "1abcdef2", "live again after the rejoin");
  await Promise.all([alice.provider.destroy(), bob.provider.destroy()]);
});

for (const [label, log, body] of [
  ["a log rebuilt to a changed body", [savedLog("abcdef")], "abXdef"],
  ["an empty log", [], "hello"],
] as const) {
  test(`sync: two clients that both seed alone (${label}) merge without a second copy`, async () => {
    const net = bus();
    let open = false;
    const held = { setAuth: () => (open ? Promise.resolve() : new Promise(() => {})) };
    const alice = client(net, 101, [...log], body, held);
    const bob = client(net, 202, [...log], body, held);
    await until(() => alice.isSeeded() && bob.isSeeded(), "both local seeds");
    assert.equal(text(alice.doc), body);
    assert.equal(text(bob.doc), body);

    open = true;
    await until(() => alice.socket.joins > 0 && bob.socket.joins > 0, "both joins");
    await tick(300);
    assert.equal(text(alice.doc), body, "one copy of the seed, not two");
    assert.equal(text(bob.doc), body);
    await Promise.all([alice.provider.destroy(), bob.provider.destroy()]);
  });
}

test("sync: a leave that never finishes does not stop the rejoin", async () => {
  const log = savedLog("abcdef");
  const net = bus();
  const alice = client(net, 101, [log], "abcdef");
  const bob = client(net, 202, [log], "abcdef", { hangUnsubscribe: true });
  await until(() => bob.isSeeded() && bob.socket.joins === 1, "bob joined");
  bob.socket.fail();
  await until(() => bob.socket.joins === 2, "bob's rejoin past the hung leave");
  await Promise.all([alice.provider.destroy(), bob.provider.destroy()]);
});

test("sync: a throw while handling the join does not leave the client cut off", async () => {
  const net = bus();
  const log = savedLog("abcdef");
  const alice = client(net, 101, [log], "abcdef");
  const bob = client(net, 202, [log], "abcdef", { connectedThrows: 1 });
  await until(() => bob.socket.joins === 2, "bob's rejoin after the throw");
  await until(() => alice.isSeeded() && bob.isSeeded(), "both seeded");
  alice.doc.getText("body").insert(0, "Z");
  await until(() => text(bob.doc).startsWith("Z"), "bob receiving alice's edit");
  await Promise.all([alice.provider.destroy(), bob.provider.destroy()]);
});

test("sync: a slow leave is waited out, so the rejoin gets a fresh channel", async () => {
  const net = bus();
  const bob = client(net, 202, [savedLog("abcdef")], "abcdef", { leaveMs: 500, joinTimeoutMs: 200 });
  await until(() => bob.isSeeded() && bob.socket.joins === 1, "bob joined");
  bob.socket.fail();
  await until(() => bob.socket.joins === 2, "bob's rejoin");
  await bob.provider.destroy();
  assert.deepEqual(bob.errors.filter((e) => e.includes("not joined")), [], "no join stalled on the leaving channel");
});

test("sync: a channel that throws while joining is retried, and construction survives it", async () => {
  const net = bus();
  const bob = client(net, 202, [savedLog("abcdef")], "abcdef", { channelThrows: 1 });
  await until(bob.isSeeded, "bob's seed");
  await until(() => bob.socket.joins === 1, "bob's join on the second try");
  await bob.provider.destroy();
});

test("sync: a channel that keeps failing right after it joins is not replaced at full rate", async () => {
  const net = bus();
  const bob = client(net, 202, [savedLog("abcdef")], "abcdef", { failOnJoin: true });
  await until(() => bob.socket.joins >= 5, "five joins");
  await bob.provider.destroy();
  const at = bob.socket.joinedAt;
  const gaps = at.slice(1).map((t, i) => t - (at[i] ?? t));
  // An errored channel first gets the join timeout (300 ms here) for the
  // client's own rejoin, so it is never replaced faster than that.
  assert.ok(
    gaps.every((gap) => gap >= 290),
    `every retry waits out the join timeout: ${gaps.join(", ")}`,
  );
});

test("sync: a client announces its presence when it joins, not only when it changes", async () => {
  const net = bus();
  const log = savedLog("abcdef");
  const alice = client(net, 101, [log], "abcdef", { awareness: true });
  const bob = client(net, 202, [log], "abcdef", { awareness: true, joinAfterMs: 100 });
  bob.awareness?.setLocalState({ name: "bob" });
  await until(
    () => (alice.awareness?.getStates().get(202) as { name?: string } | undefined)?.name === "bob",
    "alice seeing bob",
  );
  await Promise.all([alice.provider.destroy(), bob.provider.destroy()]);
  alice.awareness?.destroy();
  bob.awareness?.destroy();
});
