import assert from "node:assert/strict";
import { test } from "node:test";

import { checkUiBudget } from "../ui-budget.mjs";

const report = (over) => ({
  processes: {
    renderer: { privateMB: 120 },
    gpu: { privateMB: 60 },
    shell: { privateMB: 20 },
    postgres: { privateMB: 500 },
  },
  allocators: [
    { process: "Renderer", allocatorsMB: { "cc/tile_memory": 20 } },
    { process: "GPU Process", allocatorsMB: { "gpu/shared_images": 40 } },
  ],
  ...over,
});

test("a reader with 6 layers and a passing report has no failures", () => {
  assert.deepEqual(checkUiBudget({ path: "/reader/", layerCount: 6, report: report(), idle: false }), []);
});

test("a reader with 7 layers fails the reader layer budget", () => {
  assert.deepEqual(checkUiBudget({ path: "/reader/", layerCount: 7, report: report(), idle: false }), [
    "layers 7 > 6 on /reader/",
  ]);
});

test("other routes allow 8 layers", () => {
  assert.deepEqual(checkUiBudget({ path: "/papers/", layerCount: 7, report: report(), idle: false }), []);
  assert.deepEqual(checkUiBudget({ path: "/papers/", layerCount: 9, report: report(), idle: false }), [
    "layers 9 > 8 on /papers/",
  ]);
});

test("tile memory sums every Renderer process and fails at 30 MB", () => {
  const r = report({
    allocators: [
      { process: "Renderer", allocatorsMB: { "cc/tile_memory": 16 } },
      { process: "Renderer", allocatorsMB: { "cc/tile_memory": 16 } },
    ],
  });
  assert.deepEqual(checkUiBudget({ path: "/reader/", layerCount: 6, report: r, idle: false }), [
    "cc/tile_memory 32 MB >= 30 MB",
  ]);
});

test("gpu shared images fails at exactly 50 MB", () => {
  const r = report({
    allocators: [
      { process: "Renderer", allocatorsMB: { "cc/tile_memory": 20 } },
      { process: "GPU Process", allocatorsMB: { "gpu/shared_images": 50 } },
    ],
  });
  assert.deepEqual(checkUiBudget({ path: "/reader/", layerCount: 6, report: r, idle: false }), [
    "gpu/shared_images 50 MB >= 50 MB",
  ]);
});

test("idle false ignores private bytes even when the renderer is at 900 MB", () => {
  const r = report({
    processes: { renderer: { privateMB: 900 }, gpu: { privateMB: 60 }, postgres: { privateMB: 500 } },
  });
  assert.deepEqual(checkUiBudget({ path: "/reader/", layerCount: 6, report: r, idle: false }), []);
});

test("idle sums private bytes of every process except postgres", () => {
  assert.deepEqual(checkUiBudget({ path: "/reader/", layerCount: 6, report: report(), idle: true }), []);
  const r = report({
    processes: {
      renderer: { privateMB: 150 },
      gpu: { privateMB: 60 },
      shell: { privateMB: 20 },
      postgres: { privateMB: 500 },
    },
  });
  assert.deepEqual(checkUiBudget({ path: "/reader/", layerCount: 6, report: r, idle: true }), [
    "idle private 230 MB >= 220 MB",
  ]);
});

test("a report without an allocator dump says so", () => {
  assert.deepEqual(
    checkUiBudget({ path: "/reader/", layerCount: 6, report: report({ allocators: undefined }), idle: false }),
    ["no allocator dump (run memory.mjs with --dump)"],
  );
});

test("several failures come back in order: layers, tile, gpu, idle", () => {
  const r = report({
    processes: { renderer: { privateMB: 200 }, gpu: { privateMB: 60 }, shell: { privateMB: 20 } },
    allocators: [
      { process: "Renderer", allocatorsMB: { "cc/tile_memory": 40 } },
      { process: "GPU Process", allocatorsMB: { "gpu/shared_images": 60 } },
    ],
  });
  assert.deepEqual(checkUiBudget({ path: "/reader/", layerCount: 7, report: r, idle: true }), [
    "layers 7 > 6 on /reader/",
    "cc/tile_memory 40 MB >= 30 MB",
    "gpu/shared_images 60 MB >= 50 MB",
    "idle private 280 MB >= 220 MB",
  ]);
});
