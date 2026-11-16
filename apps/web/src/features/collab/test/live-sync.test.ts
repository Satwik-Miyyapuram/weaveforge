/**
 * Live co-editing over the in-memory transport in `fake-realtime.ts`: two or
 * three `RealtimeYjsProvider`s, each with its own `Y.Doc`, no network.
 *
 * What has to hold for "perfect sync": concurrent edits converge; an edit made
 * offline reaches the peer when the connection comes back, once; a late joiner
 * gets the whole document from the peers (not only the persisted log); a
 * reload rebuilds exactly what was there; presence follows the connection; and
 * teardown leaves no listener, timer or channel behind.
 */
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";

import { readyCore } from "@/lib/rust-core";
import { RealtimeYjsProvider } from "../infrastructure/realtime-yjs-provider";
import { FakeRealtime, memoryCrdtStore } from "./fake-realtime";

const settle = async () => {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
};

/** Let the merge timer (200 ms) and any replies run. */
async function run(ms = 250) {
  await settle();
  mock.timers.tick(ms);
  await settle();
  mock.timers.tick(ms);
  await settle();
}

// A failed assertion skips a test's own close; anything left open here would
// keep the runner alive (Awareness holds a real interval).
const open: (() => void)[] = [];
beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => {
  for (const close of open.splice(0)) close();
  mock.timers.reset();
});

function makeClient(
  server: FakeRealtime,
  store: ReturnType<typeof memoryCrdtStore>,
  opts: { awareness?: boolean; live?: boolean } = {},
) {
  const doc = new Y.Doc();
  const awareness = opts.awareness ? new Awareness(doc) : undefined;
  const client = server.client();
  const errors: string[] = [];
  const provider = new RealtimeYjsProvider({
    doc,
    db: client.db as never,
    crdtStore: store as never,
    resourceType: "vault_page",
    resourceId: "abc",
    projectId: "p1",
    authorId: "u1",
    awareness,
    live: opts.live,
    onError: (stage, detail) => errors.push(`${stage}: ${detail}`),
  });
  open.push(() => {
    void provider.destroy().catch(() => {});
    doc.destroy();
  });
  const text = () => doc.getText("body").toString();
  const close = async () => {
    await provider.destroy();
    doc.destroy();
  };
  return { doc, awareness, provider, client, errors, text, close };
}

/** Messages a client broadcast that carry document items it authored. */
function itemsSentBy(server: FakeRealtime, c: ReturnType<typeof makeClient>) {
  return server.sent.filter((s) => {
    if (!c.client.channels.includes(s.from)) return false;
    if (s.event !== "yjs" && s.event !== "sync2") return false;
    const data = (s.payload as { data?: string }).data;
    if (!data) return false;
    const update = Y.decodeUpdate(readyCore().decodeBase64(data));
    return update.structs.some((st) => st.id.client === c.doc.clientID);
  }).length;
}

test("live: concurrent edits on two clients converge", async () => {
  const server = new FakeRealtime();
  const store = memoryCrdtStore();
  const a = makeClient(server, store);
  const b = makeClient(server, store);
  await run();

  a.doc.getText("body").insert(0, "alpha ");
  b.doc.getText("body").insert(0, "beta ");
  await run();

  assert.equal(a.text(), b.text());
  assert.ok(a.text().includes("alpha ") && a.text().includes("beta "), a.text());
  await a.close();
  await b.close();
});

test("live: an edit made offline merges in when the connection returns", async () => {
  const server = new FakeRealtime();
  const store = memoryCrdtStore();
  const a = makeClient(server, store);
  const b = makeClient(server, store);
  await run();
  a.doc.getText("body").insert(0, "shared. ");
  await run();

  b.client.current().drop();
  a.doc.getText("body").insert(a.text().length, "typed by A meanwhile. ");
  b.doc.getText("body").insert(0, "typed by B offline. ");
  await run();
  assert.ok(!b.text().includes("typed by A"), "B is offline and cannot have A's edit yet");

  b.client.current().restore();
  await run();

  assert.equal(a.text(), b.text());
  for (const part of ["shared. ", "typed by A meanwhile. ", "typed by B offline. "]) {
    assert.ok(a.text().includes(part), `missing ${JSON.stringify(part)} in ${JSON.stringify(a.text())}`);
  }
  await a.close();
  await b.close();
});

test("live: both sides editing offline at once converge when both return", async () => {
  const server = new FakeRealtime();
  const store = memoryCrdtStore();
  const a = makeClient(server, store);
  const b = makeClient(server, store);
  const c = makeClient(server, store);
  await run();
  a.client.current().drop();
  b.client.current().drop();
  a.doc.getText("body").insert(0, "A alone. ");
  b.doc.getText("body").insert(0, "B alone. ");
  c.doc.getText("body").insert(0, "C online. ");
  await run();
  a.client.current().restore();
  b.client.current().restore();
  await run();
  assert.equal(a.text(), b.text());
  assert.equal(b.text(), c.text());
  for (const part of ["A alone. ", "B alone. ", "C online. "]) assert.ok(c.text().includes(part), c.text());
  await a.close();
  await b.close();
  await c.close();
});

test("live: nothing is pushed into a channel that is down", async () => {
  // The real client turns a send on an unjoined channel into a REST call that
  // fails offline (and warns on every call). The provider holds them instead.
  const server = new FakeRealtime();
  const store = memoryCrdtStore();
  const b = makeClient(server, store);
  await run();
  b.client.current().drop();
  const before = server.sent.length;
  b.doc.getText("body").insert(0, "offline");
  await run();
  assert.equal(server.sent.length, before, "no send while the channel is down");
  await b.close();
});

test("live: reconnecting resends the pending edit exactly once", async () => {
  const server = new FakeRealtime();
  const store = memoryCrdtStore();
  const a = makeClient(server, store);
  const b = makeClient(server, store);
  await run();

  b.client.current().drop();
  b.doc.getText("body").insert(0, "one ");
  b.doc.getText("body").insert(4, "two ");
  await run();
  b.client.current().restore();
  await run();
  assert.equal(a.text(), "one two ");
  assert.equal(itemsSentBy(server, b), 1, "the queued edit goes out once");

  // A second drop with nothing new must not send the old edit again.
  b.client.current().drop();
  await run();
  b.client.current().restore();
  await run();
  assert.equal(itemsSentBy(server, b), 1, "a reconnect with nothing pending sends no items");
  assert.equal(a.text(), "one two ");
  await a.close();
  await b.close();
});

test("live: a repeated update is applied once and never echoed", async () => {
  const server = new FakeRealtime();
  const store = memoryCrdtStore();
  const a = makeClient(server, store);
  const b = makeClient(server, store);
  await run();
  a.doc.getText("body").insert(0, "once");
  await run();
  const update = server.sent.find((s) => s.event === "yjs" && a.client.channels.includes(s.from))!;
  const bSentBefore = server.sent.filter((s) => b.client.channels.includes(s.from)).length;

  const ch = a.client.current();
  await ch.send({ type: "broadcast", event: "yjs", payload: update.payload });
  await ch.send({ type: "broadcast", event: "yjs", payload: update.payload });
  await run();

  assert.equal(b.text(), "once");
  assert.equal(
    server.sent.filter((s) => b.client.channels.includes(s.from)).length,
    bSentBefore,
    "B does not rebroadcast what it received",
  );
  await a.close();
  await b.close();
});

test("live: a late joiner gets the full document from a peer, not only the log", async () => {
  // A's text is not in the log yet (the idle persist is 5 s away), so only a
  // peer can give it to C.
  const server = new FakeRealtime();
  const store = memoryCrdtStore();
  const a = makeClient(server, store);
  await run();
  a.doc.getText("body").insert(0, "written before C arrived");
  await run();
  assert.equal(store.rows.length, 0, "precondition: nothing persisted yet");

  const c = makeClient(server, store);
  await run();
  assert.equal(c.text(), "written before C arrived");
  await a.close();
  await c.close();
});

test("live: a reload rebuilds exactly the state from before", async () => {
  const server = new FakeRealtime();
  const store = memoryCrdtStore();
  const a = makeClient(server, store);
  await run();
  const t = a.doc.getText("body");
  t.insert(0, "hello world");
  t.delete(0, 6);
  t.insert(t.length, " again");
  await run();
  const before = { text: a.text(), sv: Y.encodeStateVector(a.doc) };
  await a.close();

  const reloaded = makeClient(server, store);
  await run();
  assert.equal(reloaded.text(), before.text);
  assert.deepEqual(Y.encodeStateVector(reloaded.doc), before.sv);
  await reloaded.close();
});

test("live: a server-closed channel is rejoined with growing backoff", async () => {
  const server = new FakeRealtime();
  const store = memoryCrdtStore();
  const a = makeClient(server, store);
  await run();
  assert.equal(server.subscribes, 1);

  server.refuseJoins = true;
  a.client.current().serverClose();
  await settle();
  mock.timers.tick(999);
  await settle();
  assert.equal(server.subscribes, 1, "no rejoin before the first backoff");
  mock.timers.tick(1);
  await settle();
  assert.equal(server.subscribes, 2, "rejoined after 1 s");
  mock.timers.tick(1999);
  await settle();
  assert.equal(server.subscribes, 2, "the second wait is longer");
  mock.timers.tick(1);
  await settle();
  assert.equal(server.subscribes, 3, "rejoined after 2 s more");

  server.refuseJoins = false;
  mock.timers.tick(4000);
  await settle();
  assert.equal(server.subscribes, 4);
  assert.ok(a.client.current().joined, "joined again once the server accepts");

  // A healthy join resets the backoff: the next close waits 1 s again.
  a.client.current().serverClose();
  await settle();
  mock.timers.tick(1000);
  await settle();
  assert.equal(server.subscribes, 5);
  await a.close();
});

test("live: a refused token is retried", async () => {
  const server = new FakeRealtime();
  server.failAuth = true;
  const store = memoryCrdtStore();
  const a = makeClient(server, store);
  await settle();
  assert.equal(server.subscribes, 0);
  assert.ok(a.errors.some((e) => e.startsWith("setAuth: ")), JSON.stringify(a.errors));
  server.failAuth = false;
  mock.timers.tick(1000);
  await settle();
  assert.equal(server.subscribes, 1);
  await a.close();
});

test("live: teardown cancels a pending rejoin", async () => {
  const server = new FakeRealtime();
  const store = memoryCrdtStore();
  const a = makeClient(server, store);
  await run();
  a.client.current().serverClose();
  await settle();
  await a.close();
  mock.timers.tick(60_000);
  await settle();
  assert.equal(server.subscribes, 1, "no join after destroy");
});

test("live: presence is not rebroadcast by the peers that receive it", async () => {
  const server = new FakeRealtime();
  const store = memoryCrdtStore();
  const a = makeClient(server, store, { awareness: true });
  const b = makeClient(server, store, { awareness: true });
  await run();
  const fromB = () => server.sent.filter((s) => s.event === "awareness" && b.client.channels.includes(s.from)).length;
  const before = fromB();

  a.awareness!.setLocalStateField("user", { name: "A" });
  await run();
  assert.deepEqual(b.awareness!.getStates().get(a.doc.clientID), { user: { name: "A" } });
  assert.equal(fromB(), before, "B must not echo A's presence");
  await a.close();
  await b.close();
});

test("live: a late joiner sees who is already there", async () => {
  const server = new FakeRealtime();
  const store = memoryCrdtStore();
  const a = makeClient(server, store, { awareness: true });
  a.awareness!.setLocalStateField("user", { name: "A" });
  await run();
  const c = makeClient(server, store, { awareness: true });
  await run();
  assert.deepEqual(c.awareness!.getStates().get(a.doc.clientID), { user: { name: "A" } });
  await a.close();
  await c.close();
});

test("live: losing the connection clears other people's presence", async () => {
  const server = new FakeRealtime();
  const store = memoryCrdtStore();
  const a = makeClient(server, store, { awareness: true });
  const b = makeClient(server, store, { awareness: true });
  a.awareness!.setLocalStateField("user", { name: "A" });
  b.awareness!.setLocalStateField("user", { name: "B" });
  await run();
  assert.ok(b.awareness!.getStates().has(a.doc.clientID));

  b.client.current().drop();
  await settle();
  assert.ok(!b.awareness!.getStates().has(a.doc.clientID), "A's avatar goes while B is offline");
  assert.ok(b.awareness!.getStates().has(b.doc.clientID), "B keeps its own state");

  b.client.current().restore();
  await run();
  assert.ok(b.awareness!.getStates().has(a.doc.clientID), "and comes back on reconnect");
  await a.close();
  await b.close();
});

test("live: closing the editor removes its presence from peers at once", async () => {
  const server = new FakeRealtime();
  const store = memoryCrdtStore();
  const a = makeClient(server, store, { awareness: true });
  const b = makeClient(server, store, { awareness: true });
  a.awareness!.setLocalStateField("user", { name: "A" });
  await run();
  assert.ok(b.awareness!.getStates().has(a.doc.clientID));

  await a.close();
  await settle();
  assert.ok(!b.awareness!.getStates().has(a.doc.clientID), "no 30 s ghost avatar");
  await b.close();
});

test("live: teardown leaves no listener, channel or timer behind", async () => {
  const server = new FakeRealtime();
  const store = memoryCrdtStore();
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  type Obs = { _observers: Map<string, Set<unknown>> };
  const count = (o: unknown, name: string) => (o as Obs)._observers.get(name)?.size ?? 0;
  const baseline = { doc: count(doc, "update"), aw: count(awareness, "update") };
  const client = server.client();
  const provider = new RealtimeYjsProvider({
    doc,
    db: client.db as never,
    crdtStore: store as never,
    resourceType: "vault_page",
    resourceId: "abc",
    projectId: "p1",
    authorId: "u1",
    awareness,
  });
  open.push(() => doc.destroy());
  await run();
  doc.getText("body").insert(0, "x");
  client.current().serverClose(); // leaves a rejoin timer pending
  await settle();

  await provider.destroy();
  assert.equal(count(doc, "update"), baseline.doc, "doc listener removed");
  assert.equal(count(awareness, "update"), baseline.aw, "awareness listener removed");
  assert.equal(server.peersOf(client.current()).length, 0);
  const subscribes = server.subscribes;
  const sent = server.sent.length;
  mock.timers.tick(120_000);
  await settle();
  assert.equal(server.subscribes, subscribes, "no rejoin timer left");
  assert.equal(server.sent.length, sent, "no merge timer left");
  doc.destroy();
});
