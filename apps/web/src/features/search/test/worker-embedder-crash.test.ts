/**
 * A worker that dies fails the request in hand and lets the next one restart
 * (P1-15). Before, an `error` or `messageerror` event had no listener: the
 * pending promise never settled and every later search hung on it.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, mock, test } from "node:test";

import { loadTestCore } from "@/lib/test/load-test-core";
import { WorkerEmbedder } from "../infrastructure/parts-3";

before(loadTestCore);

type Msg = { id: number; type: string; texts?: string[] };
type Listener = (event: { data?: unknown }) => void;

const g = globalThis as { Worker?: unknown };
const previousWorker = g.Worker;
after(() => {
  g.Worker = previousWorker;
});

/** Workers that answer `load` at once and hold `embed` until `flush()`. */
function stubWorkers() {
  const made: FakeWorker[] = [];
  class FakeWorker {
    terminated = 0;
    held: Msg[] = [];
    private listeners = new Map<string, Listener>();
    constructor() {
      made.push(this);
    }
    addEventListener(type: string, l: Listener) {
      this.listeners.set(type, l);
    }
    emit(type: string) {
      this.listeners.get(type)?.({});
    }
    postMessage(msg: Msg) {
      if (msg.type === "load") {
        queueMicrotask(() =>
          this.listeners.get("message")?.({ data: { id: msg.id, type: "ready", dimensions: 2 } }),
        );
      } else this.held.push(msg);
    }
    flush() {
      for (const msg of this.held.splice(0)) {
        const vectors = (msg.texts ?? []).map(() => new Float32Array([1, 0]));
        this.listeners.get("message")?.({ data: { id: msg.id, type: "vectors", vectors } });
      }
    }
    terminate() {
      this.terminated += 1;
    }
  }
  g.Worker = FakeWorker;
  return made;
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => mock.timers.reset());

for (const type of ["error", "messageerror"]) {
  test(`a worker ${type} fails the request in hand and the next one restarts`, async () => {
    const made = stubWorkers();
    const e = new WorkerEmbedder();

    const first = e.embed({ texts: ["a"], kind: "query" });
    await settle();
    made[0]!.emit(type);
    await assert.rejects(first, /search encoder stopped/);
    assert.equal(made[0]!.terminated, 1, "the dead worker is let go");

    const again = e.embed({ texts: ["b"], kind: "query" });
    await settle();
    assert.equal(made.length, 2, "a fresh worker starts");
    made[1]!.flush();
    assert.equal((await again).length, 1);
    e.dispose();
  });
}
