/**
 * Where the desktop app's encoder asks for its weights.
 *
 * The page is `app://weaveforge`. A custom scheme is not CORS-enabled, so a
 * fetch to another `app:` host (`app://models`) is blocked outright and search
 * by meaning never loads. The weights are asked for under the page's own
 * origin, which the shell maps onto its model cache.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { WorkerEmbedder } from "../infrastructure/worker-embedder";

type Listener = (event: { data: unknown }) => void;

function stubWorker() {
  const loads: { host?: string }[] = [];
  class FakeWorker {
    private listener: Listener | null = null;
    addEventListener(_t: string, l: Listener) {
      this.listener = l;
    }
    postMessage(msg: { id: number; type: string; host?: string }) {
      if (msg.type === "load") loads.push({ host: msg.host });
      queueMicrotask(() => this.listener?.({ data: { id: msg.id, type: "ready", dimensions: 3 } }));
    }
    terminate() {}
  }
  (globalThis as { Worker?: unknown }).Worker = FakeWorker;
  return loads;
}

function at(location: { protocol: string; origin: string } | undefined) {
  Object.defineProperty(globalThis, "location", { value: location, configurable: true, writable: true });
}

test("the desktop app asks for weights under its own origin", async (t) => {
  t.after(() => at(undefined));
  at({ protocol: "app:", origin: "app://weaveforge" });
  const loads = stubWorker();
  const e = new WorkerEmbedder();
  await e.load();
  e.dispose();
  assert.deepEqual(loads, [{ host: "app://weaveforge/models" }]);
});

test("a browser leaves the host to the encoder library", async (t) => {
  t.after(() => at(undefined));
  at({ protocol: "https:", origin: "https://weaveforge.org" });
  const loads = stubWorker();
  const e = new WorkerEmbedder();
  await e.load();
  e.dispose();
  assert.deepEqual(loads, [{ host: undefined }]);
});

test("a host passed in wins over the app's own", async (t) => {
  t.after(() => at(undefined));
  at({ protocol: "app:", origin: "app://weaveforge" });
  const loads = stubWorker();
  const e = new WorkerEmbedder({ host: "https://mirror.example" });
  await e.load();
  e.dispose();
  assert.deepEqual(loads, [{ host: "https://mirror.example" }]);
});
