/**
 * The sample protocol, and the trap the plan names: a transferred buffer is gone.
 *
 * `postMessage(buffer, [buffer])` neuters the sender's array. The plan's naive
 * snippet kept one shared buffer and transferred it every frame, which works
 * exactly once. These tests assert the discipline that replaces it: the handed-over
 * buffer is detached, the writer's next buffer is a different allocation, the pool
 * refuses to re-issue detached memory, and the worker's return path makes the
 * allocation count stay flat over a long stroke.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  InkSamplePool,
  InkSampleWriter,
  eachInkSample,
  readInkSamples,
  INK_SAMPLE_CAPACITY,
  INK_SAMPLE_STRIDE,
  type InkStrokeHeader,
  type InkWorkerMessage,
} from "../application/capture-protocol";

const header: InkStrokeHeader = {
  strokeId: 1,
  pageIndex: 0,
  width: 6,
  tool: "pen",
  colour: "text",
};

/**
 * A writer over a recorder, which is what the hook's `post` is.
 *
 * Transfer mode posts through a real `MessageChannel`, because that is what makes
 * a transferred buffer *detached*: a fake `post` that only records the transfer
 * list would leave the sender's view intact and the test would assert nothing.
 */
function recorder(mode: "transfer" | "clone", capacity = INK_SAMPLE_CAPACITY) {
  const messages: { message: InkWorkerMessage; transfer: Transferable[] }[] = [];
  const pool = new InkSamplePool({ capacity: 4 });
  const channel = new MessageChannel();
  const writer = new InkSampleWriter({
    pool,
    mode,
    capacity,
    post: (message, transfer) => {
      messages.push({ message, transfer });
      if (transfer.length > 0) channel.port1.postMessage(message, transfer);
    },
  });
  return { messages, pool, writer };
}

test("samples are batched, not posted one at a time", () => {
  const { messages, writer } = recorder("clone", 16);
  for (let i = 0; i < 40; i += 1) {
    writer.push(100 + i, 200 + i, 128, i * 4, header);
  }
  // 40 samples into a 16-sample buffer: two automatic flushes, and one batch of
  // eight still pending. A per-sample post would have been 40 messages.
  assert.equal(messages.length, 2);
  assert.equal(writer.pending, 8);
  const first = messages[0]!.message;
  assert.equal(first.type, "samples");
  if (first.type !== "samples") return;
  assert.equal(first.sample.count, 16);
  assert.equal(first.sample.buffer.length, 16 * INK_SAMPLE_STRIDE);
});

test("a flushed batch carries x, y, pressure and t in that order", () => {
  const { messages, writer } = recorder("clone");
  writer.push(1200, 3400, 200, 16, header);
  writer.push(1210, 3408, 210, 24, header);
  writer.flush("samples", header);

  const message = messages[0]!.message;
  if (message.type !== "samples") throw new Error("expected a samples message");
  const samples = readInkSamples(message.sample);
  assert.equal(samples.count, 2);
  assert.equal(samples.x(0), 1200);
  assert.equal(samples.y(0), 3400);
  assert.equal(samples.pressure(0), 200);
  assert.equal(samples.t(0), 16);
  assert.equal(samples.x(1), 1210);
  assert.equal(samples.t(1), 24);

  // And the zero-allocation walk sees the same values.
  const seen: number[][] = [];
  eachInkSample(message.sample, (x, y, pressure, t) => seen.push([x, y, pressure, t]));
  assert.deepEqual(seen, [
    [1200, 3400, 200, 16],
    [1210, 3408, 210, 24],
  ]);
});

test("an empty frame posts nothing at all", () => {
  const { messages, writer } = recorder("clone");
  writer.flush("samples", header);
  assert.equal(messages.length, 0, "a frame where the pen did not move costs no message");
});

test("transferring detaches the buffer the worker was given", () => {
  const { messages, writer } = recorder("transfer");
  writer.push(100, 200, 128, 0, header);
  writer.flush("samples", header);

  const handedOff = writer.lastHandedOff!;
  assert.equal(handedOff.byteLength, 0, "the view the worker was handed is detached");
  assert.equal(messages[0]!.transfer.length, 1, "and its buffer travelled with the message");
  assert.ok(writer.usable, "the writer immediately took a buffer it does own");
  assert.notEqual(
    writer.current.buffer,
    handedOff.buffer,
    "so the next sample cannot be written into memory the worker now owns",
  );
});

test("the pool refuses to re-issue a buffer that is still detached", () => {
  const pool = new InkSamplePool({ capacity: 4 });
  const buffer = pool.acquire(8);
  const transferred = buffer.buffer;
  // Stand in for a transfer: the view is detached when the buffer leaves.
  structuredClone(transferred, { transfer: [transferred] });
  assert.equal(buffer.byteLength, 0, "the sender's view is neutered");
  pool.release(buffer);
  assert.equal(pool.available, 0, "detached memory is dropped rather than pooled");
  const next = pool.acquire(8);
  assert.notEqual(next.buffer, transferred, "and the pool hands out live memory");
  assert.ok(next.byteLength > 0);
});

test("cloning keeps the writer's memory, so a long stroke allocates once", () => {
  const { messages, pool, writer } = recorder("clone", 8);
  const first = writer.current.buffer;
  for (let i = 0; i < 80; i += 1) writer.push(i, i, 128, i, header);
  writer.flush("samples", header);

  assert.equal(messages[0]!.transfer.length, 0, "nothing was transferred");
  assert.equal(writer.current.buffer, first, "so the same memory is refilled");
  assert.equal(pool.created, 1, "one allocation for the whole stroke");
});

test("a buffer the worker hands back is reused rather than reallocated", () => {
  const pool = new InkSamplePool({ capacity: 4 });
  const first = pool.acquire(8);
  const raw = first.buffer;
  // The worker received this memory by transfer and posts the same ArrayBuffer
  // back; the main thread pools it rather than letting a new one be allocated.
  pool.release(raw);
  assert.equal(pool.available, 1);
  const again = pool.acquire(8);
  assert.equal(again.buffer, raw, "the same memory came back");
  assert.equal(pool.created, 1, "so nothing new was allocated");
});

test("the pool's growth is bounded by its capacity, not by the batch count", () => {
  const pool = new InkSamplePool({ capacity: 4 });
  for (let batch = 0; batch < 50; batch += 1) {
    const buffer = pool.acquire(8);
    pool.release(buffer.buffer);
  }
  assert.equal(pool.created, 1, "fifty batches over one buffer");
  assert.ok(pool.available <= 4);
});

test("an overflow flush is triggered by the capacity, not by the frame", () => {
  const { messages, writer } = recorder("clone", 4);
  for (let i = 0; i < 4; i += 1) writer.push(i, i, 128, i, header);
  assert.equal(messages.length, 0, "exactly at capacity is not over it");
  writer.push(4, 4, 128, 4, header);
  assert.equal(messages.length, 1, "one more sample flushes the buffer");
  assert.equal(writer.pending, 1);
});

test("a stroke-end batch carries whatever the frame had not sent", () => {
  const { messages, writer } = recorder("clone", 64);
  writer.push(1, 2, 3, 4, header);
  writer.flush("stroke-end", header);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.message.type, "stroke-end");
  if (messages[0]!.message.type !== "stroke-end") return;
  assert.equal(messages[0]!.message.sample.count, 1);
});
