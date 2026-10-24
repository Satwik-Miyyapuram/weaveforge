/**
 * A failed encoder start stops its worker (27-13): a worker left running after
 * a failed load would hold the WASM heap until the tab closed.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { WorkerEmbedder } from "../infrastructure/worker-embedder";

type Listener = (event: { data: unknown }) => void;

function stubWorker(reply: (msg: { id: number; type: string }) => unknown) {
  const made: { terminated: number }[] = [];
  class FakeWorker {
    terminated = 0;
    private listener: Listener | null = null;
    constructor() {
      made.push(this);
    }
    addEventListener(_t: string, l: Listener) {
      this.listener = l;
    }
    postMessage(msg: { id: number; type: string }) {
      queueMicrotask(() => this.listener?.({ data: reply(msg) }));
    }
    terminate() {
      this.terminated += 1;
    }
  }
  (globalThis as { Worker?: unknown }).Worker = FakeWorker;
  return made;
}

test("a load that errors terminates the worker and allows a retry", async () => {
  const made = stubWorker((m) => ({ id: m.id, type: "error", message: "no weights" }));
  const e = new WorkerEmbedder();
  await assert.rejects(e.load(), /no weights/);
  assert.equal(made.length, 1);
  assert.equal(made[0]!.terminated, 1);
  await assert.rejects(e.load(), /no weights/);
  assert.equal(made.length, 2);
});

test("a load answered with something other than ready terminates the worker", async () => {
  const made = stubWorker((m) => ({ id: m.id, type: "vectors", vectors: [] }));
  await assert.rejects(new WorkerEmbedder().load(), /failed to start/);
  assert.equal(made[0]!.terminated, 1);
});

test("a successful load keeps the worker running", async () => {
  const made = stubWorker((m) => ({ id: m.id, type: "ready", dimensions: 4 }));
  const e = new WorkerEmbedder();
  await e.load();
  assert.equal(e.dimensions, 4);
  assert.equal(made[0]!.terminated, 0);
  e.dispose();
});
