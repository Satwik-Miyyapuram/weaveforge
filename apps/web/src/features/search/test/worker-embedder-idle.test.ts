/**
 * The encoder's worker is stopped after a quiet period and started again on
 * the next request (M05). Its weights are 100–300 MB of WASM heap; a session
 * that searched once used to keep them until the tab closed.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import { IDLE_EVICT_MS, WorkerEmbedder } from "../infrastructure/worker-embedder";

type Msg = { id: number; type: string; texts?: string[] };
type Listener = (event: { data: unknown }) => void;

/** Workers that answer `load` at once and hold `embed` until `flush()`. */
function stubWorkers() {
  const made: FakeWorker[] = [];
  class FakeWorker {
    terminated = 0;
    held: Msg[] = [];
    private listener: Listener | null = null;
    constructor() {
      made.push(this);
    }
    addEventListener(_t: string, l: Listener) {
      this.listener = l;
    }
    postMessage(msg: Msg) {
      if (msg.type === "load") {
        queueMicrotask(() => this.listener?.({ data: { id: msg.id, type: "ready", dimensions: 2 } }));
      } else this.held.push(msg);
    }
    flush() {
      for (const msg of this.held.splice(0)) {
        const vectors = (msg.texts ?? []).map(() => new Float32Array([1, 0]));
        this.listener?.({ data: { id: msg.id, type: "vectors", vectors } });
      }
    }
    terminate() {
      this.terminated += 1;
    }
  }
  (globalThis as { Worker?: unknown }).Worker = FakeWorker;
  return made;
}

/** Let queued microtasks (the fake replies and awaits) run. */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

async function embedNow(e: WorkerEmbedder, made: { flush(): void }[]) {
  const vectors = e.embed({ texts: ["a"], kind: "query" });
  await settle();
  made.at(-1)!.flush();
  return vectors;
}

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => mock.timers.reset());

test("a quiet encoder is stopped, and the next query starts it again and answers", async () => {
  const made = stubWorkers();
  const e = new WorkerEmbedder();
  assert.equal((await embedNow(e, made)).length, 1);

  mock.timers.tick(IDLE_EVICT_MS - 1);
  assert.equal(made[0]!.terminated, 0, "not before the quiet period ends");
  mock.timers.tick(1);
  assert.equal(made[0]!.terminated, 1, "stopped once it ends");

  const again = await embedNow(e, made);
  assert.equal(made.length, 2, "a fresh worker loads the model again");
  assert.deepEqual([...again[0]!], [1, 0]);
  e.dispose();
});

test("a load with no query after it is stopped too", async () => {
  // Stored vectors that are all current mean `load()` and then no `embed`:
  // the model used to stay for the whole session.
  const made = stubWorkers();
  const e = new WorkerEmbedder();
  await e.load();
  mock.timers.tick(IDLE_EVICT_MS);
  assert.equal(made[0]!.terminated, 1);
  e.dispose();
});

test("an encoder busy at the deadline is not stopped mid-index", async () => {
  const made = stubWorkers();
  const e = new WorkerEmbedder();
  await embedNow(e, made);

  // A batch still being embedded when the quiet period would have ended.
  mock.timers.tick(IDLE_EVICT_MS - 10);
  const batch = e.embed({ texts: ["b", "c"], kind: "passage" });
  await settle();
  mock.timers.tick(IDLE_EVICT_MS * 2);
  assert.equal(made[0]!.terminated, 0, "a request in flight holds the worker");

  made[0]!.flush();
  assert.equal((await batch).length, 2);
  mock.timers.tick(IDLE_EVICT_MS - 1);
  assert.equal(made[0]!.terminated, 0, "the quiet period counts from the last answer");
  mock.timers.tick(1);
  assert.equal(made[0]!.terminated, 1);
  e.dispose();
});

test("steady use keeps the same worker", async () => {
  const made = stubWorkers();
  const e = new WorkerEmbedder();
  for (let i = 0; i < 4; i++) {
    await embedNow(e, made);
    mock.timers.tick(IDLE_EVICT_MS - 1);
  }
  assert.equal(made.length, 1);
  assert.equal(made[0]!.terminated, 0);
  e.dispose();
});
