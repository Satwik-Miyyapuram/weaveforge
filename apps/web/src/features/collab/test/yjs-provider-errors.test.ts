/**
 * The provider's background work — the idle persist, the token-then-join and
 * the broadcast handlers — runs with nobody awaiting it. A failure there has
 * to reach `onError`, not surface as an unhandled rejection (33-04, 33-06), and
 * a join that resolves after teardown must not subscribe again (33-05).
 */
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";

import { encodeBase64 } from "@/lib/bytea";
import { RealtimeYjsProvider } from "../infrastructure/realtime-yjs-provider";

type Handler = (msg: { payload: unknown }) => void;

function harness() {
  const order: string[] = [];
  const errors: string[] = [];
  const handlers = new Map<string, Handler>();
  let releaseAuth: (() => void) | null = null;
  let holdAuth = false;

  const channel = {
    topic: "realtime:crdt:vault_page:abc",
    on(_type: string, filter: { event: string }, cb: Handler) {
      handlers.set(filter.event, cb);
      return channel;
    },
    subscribe() {
      order.push("subscribe");
      return channel;
    },
    send: async () => "ok",
    unsubscribe: async () => {
      order.push("unsubscribe");
      return "ok";
    },
  };
  const db = {
    channel: () => channel,
    realtime: {
      setAuth: () =>
        holdAuth ? new Promise<void>((resolve) => (releaseAuth = resolve)) : Promise.resolve(),
    },
  };
  const crdtStore = {
    listAfter: async () => [] as { id: number; payload: Uint8Array }[],
    append: async (): Promise<{ id: number }> => ({ id: 1 }),
    countAfter: async () => 0,
  };

  const make = () => {
    const doc = new Y.Doc();
    const provider = new RealtimeYjsProvider({
      doc,
      db: db as never,
      crdtStore: crdtStore as never,
      resourceType: "vault_page",
      resourceId: "abc",
      projectId: "p1",
      authorId: "u1",
      awareness: undefined,
      onError: (stage, detail) => errors.push(`${stage}: ${detail}`),
    });
    return { doc, provider };
  };

  return {
    order,
    errors,
    handlers,
    crdtStore,
    db,
    make,
    holdAuth: () => {
      holdAuth = true;
    },
    releaseAuth: () => releaseAuth?.(),
  };
}

async function withUnhandled(run: () => Promise<void>): Promise<unknown[]> {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    await run();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 10));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  return unhandled;
}

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

test("provider: a rejected idle persist is reported, not left unhandled (33-04)", async () => {
  const h = harness();
  h.crdtStore.append = async () => {
    throw new Error("fetch failed");
  };
  let provider: RealtimeYjsProvider | undefined;
  const unhandled = await withUnhandled(async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const made = h.make();
      provider = made.provider;
      await settle();
      made.doc.getText("body").insert(0, "typed offline");
      mock.timers.tick(5_000);
      await settle();
    } finally {
      mock.timers.reset();
    }
  });
  // Read before teardown: destroy's own flush reports a failure too.
  const reported = [...h.errors];
  await provider?.destroy();
  assert.deepEqual(unhandled, []);
  assert.ok(
    reported.some((e) => e === "persist: fetch failed"),
    `the failed persist is reported; saw ${JSON.stringify(reported)}`,
  );
});

test("provider: a join whose token arrives after teardown does not subscribe (33-05)", async () => {
  const h = harness();
  h.holdAuth();
  const { provider } = h.make();
  await provider.destroy();
  h.releaseAuth();
  await settle();
  assert.ok(!h.order.includes("subscribe"), `no join after destroy; saw ${JSON.stringify(h.order)}`);
});

test("provider: a join whose token arrives in time still subscribes", async () => {
  const h = harness();
  h.holdAuth();
  const { provider } = h.make();
  h.releaseAuth();
  await settle();
  assert.ok(h.order.includes("subscribe"));
  await provider.destroy();
});

test("provider: a malformed document update is reported, not left unhandled (33-06)", async () => {
  const h = harness();
  const { doc, provider } = h.make();
  doc.getText("body").insert(0, "kept");
  const unhandled = await withUnhandled(async () => {
    h.handlers.get("yjs")!({ payload: { data: encodeBase64(new Uint8Array([255, 255, 255, 255, 255])) } });
    h.handlers.get("yjs")!({ payload: { data: "%%% not base64 %%%" } });
  });
  await provider.destroy();
  assert.deepEqual(unhandled, []);
  assert.equal(h.errors.filter((e) => e.startsWith("receive: ")).length, 2, JSON.stringify(h.errors));
  assert.equal(doc.getText("body").toString(), "kept");
});

test("provider: a malformed awareness update is reported, not left unhandled (33-06)", async () => {
  const h = harness();
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const provider = new RealtimeYjsProvider({
    doc,
    db: h.db as never,
    crdtStore: h.crdtStore as never,
    resourceType: "vault_page",
    resourceId: "abc",
    projectId: "p1",
    authorId: "u1",
    awareness,
    onError: (stage, detail) => h.errors.push(`${stage}: ${detail}`),
  });
  const unhandled = await withUnhandled(async () => {
    h.handlers.get("awareness")!({ payload: { data: encodeBase64(new Uint8Array([5, 255, 255, 255])) } });
  });
  await provider.destroy();
  awareness.destroy();
  assert.deepEqual(unhandled, []);
  assert.ok(h.errors.some((e) => e.startsWith("receive: ")), JSON.stringify(h.errors));
});

test("provider: a well-formed remote update is applied", async () => {
  const h = harness();
  const { doc, provider } = h.make();
  const other = new Y.Doc();
  other.getText("body").insert(0, "from a peer");
  h.handlers.get("yjs")!({ payload: { data: encodeBase64(Y.encodeStateAsUpdate(other)) } });
  await settle();
  assert.equal(doc.getText("body").toString(), "from a peer");
  assert.deepEqual(h.errors, []);
  await provider.destroy();
});
