/**
 * The recogniser helper's contract, tested two ways.
 *
 * The first half drives the client against a **fake** process, so the protocol,
 * the timeouts and the failure paths are covered on any machine and on any OS.
 * The second half runs the **real** helper, and is skipped unless the executable
 * has been built — which is honest rather than convenient: the C# side can only be
 * exercised where a Windows SDK and a .NET runtime are, and a test that pretended
 * otherwise would be a test of nothing.
 *
 * The real-helper half is what pinned three things that were guesses before it ran:
 * the exit code (see `Program.cs` — Windows Ink fail-fasts this process at
 * teardown), the warm per-page time, and that `InkAnalyzer` takes no vocabulary
 * hints.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { createInkRecogniser, inkRecogniserPath } from "../src/ink-recogniser";

/** A stand-in helper: a real duplex pipe, so the client's parsing is exercised. */
function fakeHelper(options: { ready?: boolean; echo?: boolean } = {}) {
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams & {
    stdin: PassThrough;
    written: string[];
  };
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const written: string[] = [];
  stdin.setEncoding("utf8");
  stdin.on("data", (chunk: string) => {
    for (const line of String(chunk).split("\n")) {
      if (!line.trim()) continue;
      written.push(line);
      const request = JSON.parse(line) as { id?: number; type: string; lines?: unknown[] };
      if (request.type === "quit") {
        setImmediate(() => child.emit("exit", 0));
        continue;
      }
      if (request.type === "haptics-probe") {
        setImmediate(() =>
          stdout.write(`${JSON.stringify({ id: request.id, type: "haptics", available: true })}
`),
        );
        continue;
      }
      if (request.type === "recognise" && options.echo !== false) {
        const count = request.lines?.length ?? 0;
        setImmediate(() =>
          stdout.write(
            `${JSON.stringify({
              id: request.id,
              type: "recognised",
              engine: "windows-ink@1",
              ms: 7,
              lines: Array.from({ length: count }, (_unused, index) => ({
                text: `line ${index}`,
                confidence: 1,
              })),
            })}\n`,
          ),
        );
      }
    }
  });
  if (options.ready !== false) {
    setImmediate(() =>
      stdout.write(`${JSON.stringify({ type: "ready", engine: "windows-ink@1", version: "fake" })}\n`),
    );
  }
  Object.assign(child, {
    stdin,
    stdout,
    stderr,
    killed: false,
    kill: () => {
      Object.assign(child, { killed: true });
      child.emit("exit", 0);
      return true;
    },
    written,
  });
  return child as ChildProcessWithoutNullStreams & { written: string[] };
}

test("the helper's path is per platform and per architecture, or null", () => {
  assert.equal(
    inkRecogniserPath({ platform: "linux", arch: "x64", root: "/app" }),
    null,
    "there is no Windows Ink off Windows",
  );
  // Joined with the host's separator: the path is built for the machine the
  // test runs on, which is a Linux runner as often as a Windows desk.
  assert.equal(
    inkRecogniserPath({ platform: "win32", arch: "arm64", root: "C:\\app" }),
    path.join("C:\\app", "native", "ink-recogniser", "win-arm64", "ink-recogniser.exe"),
  );
  assert.equal(
    inkRecogniserPath({ platform: "win32", arch: "x64", root: "C:\\app" }),
    path.join("C:\\app", "native", "ink-recogniser", "win-x64", "ink-recogniser.exe"),
  );
  assert.equal(inkRecogniserPath({ platform: "win32", arch: "ia32", root: "C:\\app" }), null);
});

test("a request is correlated by id and answered with its lines", async () => {
  const helper = fakeHelper();
  const recogniser = createInkRecogniser({
    executable: "fake.exe",
    spawnHelper: () => helper,
  });
  assert.equal(await recogniser.available(), true);
  assert.equal(recogniser.version, "fake");

  const result = await recogniser.recognise({
    lines: [{ strokes: [[0, 0, 128, 10, 10, 128]] }, { strokes: [[0, 50, 128, 10, 60, 128]] }],
    vocabulary: ["Graph-prior module"],
    lang: "en-US",
  });
  assert.equal(result.engine, "windows-ink@1");
  assert.equal(result.ms, 7);
  assert.deepEqual(
    result.lines.map((line) => line.text),
    ["line 0", "line 1"],
  );

  // What actually went on the wire: one JSON object per line, with the vocabulary
  // carried through even though this engine ignores it, so the protocol is the
  // engine's business rather than the caller's.
  const sent = JSON.parse(helper.written[0]!) as {
    type: string;
    lines: unknown[];
    vocabulary: string[];
    lang: string;
  };
  assert.equal(sent.type, "recognise");
  assert.equal(sent.lines.length, 2);
  assert.deepEqual(sent.vocabulary, ["Graph-prior module"]);
  assert.equal(sent.lang, "en-US");
  recogniser.dispose();
});

test("two pages in flight are both answered, not serialised", async () => {
  const helper = fakeHelper();
  const recogniser = createInkRecogniser({ executable: "fake.exe", spawnHelper: () => helper });
  const [first, second] = await Promise.all([
    recogniser.recognise({ lines: [{ strokes: [[0, 0, 128, 1, 1, 128]] }] }),
    recogniser.recognise({ lines: [{ strokes: [[0, 0, 128, 1, 1, 128]] }, { strokes: [[0, 9, 128, 1, 9, 128]] }] }),
  ]);
  assert.equal(first.lines.length, 1);
  assert.equal(second.lines.length, 2);
  const ids = helper.written.map((line) => (JSON.parse(line) as { id: number }).id);
  assert.deepEqual(ids, [1, 2], "each request carries its own id");
  recogniser.dispose();
});

test("a helper that never says ready is given up on, and its process is killed", async () => {
  const helper = fakeHelper({ ready: false });
  const recogniser = createInkRecogniser({
    executable: "fake.exe",
    spawnHelper: () => helper,
    // The real wait is thirty seconds, which is right for a cold CLR start and
    // wrong for a test.
    readyTimeoutMs: 20,
  });
  assert.equal(await recogniser.available(), false, "a silent helper is not available");
  assert.equal(helper.killed, true, "and it is killed rather than left running");
  await assert.rejects(recogniser.recognise({ lines: [] }), /not available/);
  recogniser.dispose();
});

test("a process that dies mid-request fails the request rather than hanging", async () => {
  const helper = fakeHelper({ echo: false });
  const recogniser = createInkRecogniser({ executable: "fake.exe", spawnHelper: () => helper, timeoutMs: 500 });
  await recogniser.available();
  const pending = recogniser.recognise({ lines: [{ strokes: [[0, 0, 128]] }] });
  setTimeout(() => helper.emit("exit", 0), 10);
  await assert.rejects(pending, /stopped before answering/);
  recogniser.dispose();
});

test("a process that cannot start reports unavailable rather than throwing", async () => {
  const recogniser = createInkRecogniser({
    executable: "C:\\does-not-exist.exe",
    spawnHelper: () => {
      throw new Error("ENOENT");
    },
  });
  assert.equal(await recogniser.available(), false);
  await assert.rejects(recogniser.recognise({ lines: [] }), /not available/);
  recogniser.dispose();
});

test("no helper for this platform means unavailable and no spawn at all", async () => {
  const recogniser = createInkRecogniser({ executable: null });
  assert.equal(recogniser.executable, null);
  assert.equal(await recogniser.available(), false);
  recogniser.dispose();
});

test("haptics: nothing is written until the probe has said yes, then samples go unanswered", async () => {
  const helper = fakeHelper();
  const recogniser = createInkRecogniser({ executable: "fake.exe", spawnHelper: () => helper });
  // Before the probe: a sample is dropped, not queued — a stroke never waits on it.
  recogniser.haptics({ type: "update", pressure: 0.5, velocity: 1 });
  assert.equal(await recogniser.hapticsAvailable(), true);
  assert.equal(await recogniser.hapticsAvailable(), true, "cached: one probe per process");
  recogniser.haptics({ type: "tool", tool: "pen" });
  recogniser.haptics({ type: "update", pressure: 0.5, velocity: 1 });
  recogniser.haptics({ type: "stop" });
  await new Promise((resolve) => setImmediate(resolve));
  const types = helper.written.map((line) => (JSON.parse(line) as { type: string }).type);
  assert.deepEqual(types, ["haptics-probe", "haptics-tool", "haptics-update", "haptics-stop"]);
  const update = JSON.parse(helper.written[2]!) as { id?: number; pressure: number; velocity: number };
  assert.equal(update.id, undefined, "no id: nothing answers a sample");
  assert.deepEqual([update.pressure, update.velocity], [0.5, 1]);
  recogniser.dispose();
});

/* -------------------------------------------------------------------------
 * The real helper, where one has been built
 * ------------------------------------------------------------------------- */

const helperPath = inkRecogniserPath({
  platform: "win32",
  arch: process.arch,
  root: `${import.meta.dirname}/..`,
});
const built = helperPath !== null && existsSync(helperPath);

/** Two short rows of letter-ish strokes, in 0.1 mm units. */
function handwriting(seed: number): number[][] {
  const strokes: number[][] = [];
  for (let letter = 0; letter < 6; letter += 1) {
    const points: number[] = [];
    for (let i = 0; i < 14; i += 1) {
      points.push(
        300 + letter * 60 + i * 4,
        seed + Math.round(Math.sin(i / 2.5 + letter) * 12),
        140,
      );
    }
    strokes.push(points);
  }
  return strokes;
}

test(
  "the real helper recognises a page and exits cleanly",
  { skip: built ? false : "the helper has not been built (apps/desktop/native/ink-recogniser)" },
  async (t) => {
    const recogniser = createInkRecogniser({ executable: helperPath, timeoutMs: 30_000 });
    try {
      assert.equal(await recogniser.available(), true, "the helper starts and reports ready");
      assert.ok(recogniser.version && recogniser.version.length > 0);
      // The haptics API is Windows 11's; a yes says the OS has it, not that a
      // pen is in the hand. The samples after it must not upset the recogniser.
      const haptics = await recogniser.hapticsAvailable();
      t.diagnostic(`helper: haptics available=${haptics}`);
      recogniser.haptics({ type: "tool", tool: "pen" });
      recogniser.haptics({ type: "update", pressure: 0.6, velocity: 0.9 });
      recogniser.haptics({ type: "stop" });

      const cold = await recogniser.recognise({
        lines: [
          { strokes: handwriting(300) },
          { strokes: handwriting(420) },
          { strokes: handwriting(540) },
        ],
        lang: "en-US",
      });
      const warmStart = performance.now();
      const warm = await recogniser.recognise({
        lines: [{ strokes: handwriting(300) }, { strokes: handwriting(420) }],
        lang: "en-US",
      });
      const warmMs = performance.now() - warmStart;

      t.diagnostic(
        `helper: cold page ${cold.ms} ms (engine), warm page ${warmMs.toFixed(1)} ms wall; ` +
          `engine=${cold.engine}; lines=${cold.lines.length}/${warm.lines.length}`,
      );

      assert.equal(cold.engine, "windows-ink@1");
      // One answer per requested line, whatever the engine made of the content:
      // the *accuracy* gate is §5.5 and needs real handwriting, so it is not
      // asserted here. What is asserted is that the contract holds.
      assert.equal(cold.lines.length, 3);
      assert.equal(warm.lines.length, 2);
      for (const line of cold.lines) {
        assert.equal(typeof line.text, "string");
        assert.ok(line.confidence === 0 || line.confidence === 1);
      }
      // Every line the engine read carries text; a line it did not is empty rather
      // than invented.
      for (const line of cold.lines) {
        if (line.text.length > 0) assert.equal(line.confidence, 1);
      }
      // The evidence the client scores a line from: per word, the readings and
      // the dictionary's verdict on each (null with no dictionary installed).
      for (const line of cold.lines) {
        for (const word of line.words ?? []) {
          assert.ok(word.candidates.length > 0);
          if (word.known !== null) assert.equal(word.known.length, word.candidates.length);
        }
      }
    } finally {
      recogniser.dispose();
    }
  },
);
