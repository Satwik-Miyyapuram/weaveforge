/**
 * The desktop shell runs the encoder natively through shell commands; the
 * embedder must behave like `WorkerEmbedder` to the search code above it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { DesktopBridge } from "../../../lib/desktop/desktop-bridge";
import {
  NOT_LOADED,
  NativeEmbedder,
  nativeEmbedBridge,
  type NativeEmbedBridge,
} from "../infrastructure/native-embedder";
import { DEFAULT_EMBEDDING_MODEL, embeddingProfile } from "../infrastructure/embedding-models";

const MODEL = "Xenova/all-MiniLM-L6-v2";

/**
 * A bridge that records calls. Each text embeds to `[index, 1]`. The first
 * `dropTexts` embeds reject as the shell does after dropping an idle model.
 */
function fakeBridge(
  options: {
    failLoads?: number;
    dropTexts?: number;
    progress?: [number, number, string][];
  } = {},
) {
  const calls = {
    loads: [] as string[],
    texts: [] as { model: string; texts: string[]; kind: string }[],
    unloads: [] as string[],
    unsubscribed: 0,
  };
  let failLoads = options.failLoads ?? 0;
  let dropTexts = options.dropTexts ?? 0;
  let listener: ((loaded: number, total: number, model: string) => void) | null = null;
  const bridge: NativeEmbedBridge = {
    embedLoad: async (model) => {
      calls.loads.push(model);
      for (const [loaded, total, from] of options.progress ?? []) listener?.(loaded, total, from);
      if (failLoads > 0) {
        failLoads -= 1;
        throw new Error("offline");
      }
      return { dimensions: 2 };
    },
    embedTexts: async (model, texts, kind) => {
      calls.texts.push({ model, texts: [...texts], kind });
      if (dropTexts > 0) {
        dropTexts -= 1;
        throw new Error(NOT_LOADED);
      }
      return texts.map((_, i) => [i, 1]);
    },
    embedUnload: async (model) => {
      calls.unloads.push(model);
    },
    onEmbedProgress: (next) => {
      listener = next;
      return () => {
        calls.unsubscribed += 1;
        listener = null;
      };
    },
  };
  return { bridge, calls };
}

const asBridge = (value: object) => value as DesktopBridge;

test("nativeEmbedBridge needs both embedLoad and embedTexts", () => {
  assert.equal(nativeEmbedBridge(null), null);
  assert.equal(nativeEmbedBridge(asBridge({})), null);
  assert.equal(nativeEmbedBridge(asBridge({ embedLoad: async () => ({ dimensions: 2 }) })), null);

  const both = asBridge({
    embedLoad: async () => ({ dimensions: 2 }),
    embedTexts: async () => [],
  });
  assert.equal(nativeEmbedBridge(both), both);
});

test("id and minScore follow the model profile", () => {
  const { bridge } = fakeBridge();
  const named = new NativeEmbedder(bridge, { model: MODEL });
  assert.equal(named.id, embeddingProfile(MODEL).id);
  assert.equal(named.minScore, embeddingProfile(MODEL).minScore);

  const fallback = new NativeEmbedder(bridge);
  assert.equal(fallback.id, DEFAULT_EMBEDDING_MODEL.id);
  assert.equal(fallback.minScore, DEFAULT_EMBEDDING_MODEL.minScore);
});

test("concurrent embeds share one load and return the bridge's rows", async () => {
  const { bridge, calls } = fakeBridge();
  const e = new NativeEmbedder(bridge, { model: MODEL });
  assert.equal(e.dimensions, 0);

  const [first, second] = await Promise.all([
    e.embed({ texts: ["x"], kind: "passage" }),
    e.embed({ texts: ["y", "z"], kind: "query" }),
  ]);

  assert.deepEqual(calls.loads, [MODEL], "the model loads once");
  assert.equal(e.dimensions, 2);
  assert.deepEqual(calls.texts, [
    { model: MODEL, texts: ["x"], kind: "passage" },
    { model: MODEL, texts: ["y", "z"], kind: "query" },
  ]);
  assert.ok(first[0] instanceof Float32Array);
  assert.deepEqual([...first[0]!], [0, 1]);
  assert.deepEqual([...second[1]!], [1, 1]);
});

test("empty texts return [] without touching the bridge", async () => {
  const { bridge, calls } = fakeBridge();
  const e = new NativeEmbedder(bridge);
  assert.deepEqual(await e.embed({ texts: [], kind: "query" }), []);
  assert.equal(calls.loads.length, 0);
  assert.equal(calls.texts.length, 0);
});

test("an already-aborted signal rejects before any bridge call", async () => {
  const { bridge, calls } = fakeBridge();
  const e = new NativeEmbedder(bridge);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(e.embed({ texts: ["a"], kind: "query", signal: controller.signal }), {
    name: "AbortError",
  });
  assert.equal(calls.loads.length, 0);
  assert.equal(calls.texts.length, 0);
});

test("a failed load rejects, and the next embed retries it", async () => {
  const { bridge, calls } = fakeBridge({ failLoads: 1 });
  const e = new NativeEmbedder(bridge);
  await assert.rejects(e.embed({ texts: ["a"], kind: "query" }), { message: "offline" });

  const rows = await e.embed({ texts: ["a"], kind: "query" });
  assert.equal(rows.length, 1);
  assert.equal(calls.loads.length, 2, "the failure was not cached");
});

test("only this model's load progress reaches onProgress, and the listener is removed after load", async () => {
  const { bridge, calls } = fakeBridge({
    progress: [
      [1, 3, MODEL],
      [2, 3, "other/model"],
      [3, 3, MODEL],
    ],
  });
  const seen: [number, number][] = [];
  const e = new NativeEmbedder(bridge, {
    model: MODEL,
    onProgress: (loaded, total) => seen.push([loaded, total]),
  });
  await e.embed({ texts: ["a"], kind: "query" });

  assert.deepEqual(seen, [
    [1, 3],
    [3, 3],
  ]);
  assert.equal(calls.unsubscribed, 1);
});

test("a model the shell dropped while idle is loaded again and the embed retried once", async () => {
  const { bridge, calls } = fakeBridge({ dropTexts: 1 });
  const e = new NativeEmbedder(bridge, { model: MODEL });
  await e.load();

  const rows = await e.embed({ texts: ["a"], kind: "query" });
  assert.deepEqual([...rows[0]!], [0, 1]);
  assert.deepEqual(calls.loads, [MODEL, MODEL]);
  assert.equal(calls.texts.length, 2);
});

test("a second drop in a row rejects instead of looping", async () => {
  const { bridge, calls } = fakeBridge({ dropTexts: 2 });
  const e = new NativeEmbedder(bridge, { model: MODEL });
  await assert.rejects(e.embed({ texts: ["a"], kind: "query" }), { message: NOT_LOADED });
  assert.equal(calls.texts.length, 2);
});

test("other embed errors are not retried", async () => {
  const { bridge, calls } = fakeBridge();
  bridge.embedTexts = async () => {
    throw new Error("bad input");
  };
  const e = new NativeEmbedder(bridge, { model: MODEL });
  await assert.rejects(e.embed({ texts: ["a"], kind: "query" }), { message: "bad input" });
  assert.deepEqual(calls.loads, [MODEL]);
});

test("dispose unloads this model in the shell, and a later embed loads it again", async () => {
  const { bridge, calls } = fakeBridge();
  const e = new NativeEmbedder(bridge, { model: MODEL });
  await e.embed({ texts: ["a"], kind: "query" });
  e.dispose();
  assert.deepEqual(calls.unloads, [MODEL]);

  await e.embed({ texts: ["b"], kind: "query" });
  assert.deepEqual(calls.loads, [MODEL, MODEL]);
});

test("dispose swallows a failed unload and works without embedUnload", async () => {
  const { bridge } = fakeBridge();
  bridge.embedUnload = async () => {
    throw new Error("gone");
  };
  new NativeEmbedder(bridge).dispose();
  delete bridge.embedUnload;
  new NativeEmbedder(bridge).dispose();
  await new Promise((resolve) => setImmediate(resolve));
});

test("a wrong row count rejects", async () => {
  const { bridge } = fakeBridge();
  bridge.embedTexts = async () => [[1, 0]];
  const e = new NativeEmbedder(bridge);
  await assert.rejects(e.embed({ texts: ["a", "b"], kind: "passage" }), {
    message: "The encoder returned the wrong number of vectors.",
  });
});
