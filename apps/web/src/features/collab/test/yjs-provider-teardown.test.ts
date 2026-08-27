/**
 * `EncryptedYjsProvider.destroy()` must leave the channel in its synchronous
 * prologue, before it awaits anything.
 *
 * It used to unsubscribe last, after persisting — a network round trip. React
 * had already mounted the replacement editor and joined the same topic by then,
 * and supabase-js keys channels by topic, so the late `phx_leave` closed the
 * *new* channel. Live sync was dead for the rest of the session while the
 * editor still looked fine and every join reported SUBSCRIBED.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";

import { EncryptedYjsProvider } from "../infrastructure/encrypted-yjs-provider";

/** Records the order of the operations we care about. */
function harness(opts: { persistDelayMs?: number } = {}) {
  const order: string[] = [];

  const channel = {
    topic: "realtime:crdt:vault_page:abc",
    on() {
      return channel;
    },
    subscribe(cb?: (status: string, err?: Error) => void) {
      order.push("subscribe");
      cb?.("SUBSCRIBED");
      return channel;
    },
    send: async () => {
      order.push("send");
      return "ok";
    },
    unsubscribe: async () => {
      order.push("unsubscribe");
      return "ok";
    },
  };

  const db = {
    channel: () => channel,
    realtime: { setAuth: async () => undefined },
    removeChannel: async () => {
      order.push("removeChannel");
      return "ok";
    },
  };

  const crdtStore = {
    listAfter: async () => {
      order.push("listAfter");
      return [] as { id: number; payload: Uint8Array }[];
    },
    append: async () => {
      order.push("append:start");
      if (opts.persistDelayMs) await new Promise((r) => setTimeout(r, opts.persistDelayMs));
      order.push("append:done");
      return { id: 1 };
    },
    countAfter: async () => 0,
  };

  return { order, channel, db, crdtStore };
}

function makeProvider(h: ReturnType<typeof harness>) {
  const doc = new Y.Doc();
  const provider = new EncryptedYjsProvider({
    doc,
    // The provider narrows this internally; the harness stands in for the client.
    db: h.db as never,
    crdtStore: h.crdtStore as never,
    resourceType: "vault_page",
    resourceId: "abc",
    projectId: "p1",
    authorId: "u1",
  });
  return { doc, provider };
}

test("provider: destroy leaves the channel before it awaits persistence", async () => {
  const h = harness({ persistDelayMs: 30 });
  const { doc, provider } = makeProvider(h);
  doc.getText("body").insert(0, "some text so there is state to persist");

  await provider.destroy();

  const left = h.order.findIndex((o) => o === "unsubscribe" || o === "removeChannel");
  const persistStarted = h.order.indexOf("append:start");
  assert.ok(left >= 0, `expected the channel to be left; saw ${JSON.stringify(h.order)}`);
  assert.ok(persistStarted >= 0, `expected a persist; saw ${JSON.stringify(h.order)}`);
  assert.ok(
    left < persistStarted,
    `the channel must be left before persisting begins; saw ${JSON.stringify(h.order)}`,
  );
});

test("provider: the leave is synchronous, so a replacement can join safely", async () => {
  // The real sequence: React runs cleanup, then immediately mounts the next
  // editor. Whatever `destroy()` does after its first await happens *after*
  // that new editor has joined — so the leave has to be before it.
  const h = harness({ persistDelayMs: 50 });
  const { doc, provider } = makeProvider(h);
  doc.getText("body").insert(0, "text");

  const pending = provider.destroy();          // not awaited, exactly like the cleanup
  const leftImmediately = h.order.some((o) => o === "unsubscribe" || o === "removeChannel");
  assert.ok(
    leftImmediately,
    `the channel must be released in destroy()'s synchronous prologue; saw ${JSON.stringify(h.order)}`,
  );
  await pending;
});

test("provider: destroy flushes the document to the CRDT log", async () => {
  // The `destroyed` flag is set at the top of `destroy()`, and `persistTail`
  // bails on it — so the closing flush wrote nothing. Everything typed since
  // the last idle persist reached the row body and never reached the log, and
  // reopening replayed a log that was behind and showed stale text.
  const h = harness();
  const { doc, provider } = makeProvider(h);
  doc.getText("body").insert(0, "typed in the last few seconds before closing");

  await provider.destroy();

  assert.ok(
    h.order.includes("append:done"),
    `teardown must persist the tail; saw ${JSON.stringify(h.order)}`,
  );
});

test("provider: the idle timer still cannot persist after teardown", async () => {
  // The flag has to keep doing its original job: a timer that fires into a
  // provider that has gone away must not write.
  const h = harness();
  const { doc, provider } = makeProvider(h);
  doc.getText("body").insert(0, "text");
  await provider.destroy();

  const afterTeardown = h.order.length;
  // Anything the provider might still have queued gets a chance to run.
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.order.length, afterTeardown, "no writes after destroy has settled");
});

test("provider: destroy does not disconnect the shared socket", async () => {
  // `removeChannel` empties the client's registry, and supabase-js disconnects
  // the socket once it is empty — taking the project-wide cache-invalidation
  // channel down with the editor.
  const h = harness();
  const { provider } = makeProvider(h);
  await provider.destroy();
  assert.ok(
    !h.order.includes("removeChannel"),
    "destroy must unsubscribe, not remove the channel from the client",
  );
  assert.ok(h.order.includes("unsubscribe"));
});

test("provider: solo opens no channel and broadcasts nothing", async () => {
  // A copy with no account has no peers and no socket to reach. Opening the
  // channel anyway sent a failing broadcast on every keystroke and put a "live
  // sync unavailable" notice under a document nobody else can open. The CRDT
  // log still has to be written: solo means no transport, not no history.
  const h = harness();
  const doc = new Y.Doc();
  const provider = new EncryptedYjsProvider({
    doc,
    db: h.db as never,
    crdtStore: h.crdtStore as never,
    resourceType: "vault_page",
    resourceId: "abc",
    projectId: "p1",
    authorId: "u1",
    live: false,
  });
  doc.getText("body").insert(0, "typed with nobody else around");

  await provider.destroy();

  for (const op of ["subscribe", "send", "unsubscribe", "removeChannel"]) {
    assert.ok(!h.order.includes(op), `solo must not ${op}; saw ${JSON.stringify(h.order)}`);
  }
  assert.ok(
    h.order.includes("append:done"),
    `solo must still write the log; saw ${JSON.stringify(h.order)}`,
  );
});
