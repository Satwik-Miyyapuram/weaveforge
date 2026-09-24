import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { APP_LOG_FILENAME, MAX_ENTRIES, createAppLog } from "../src/app-log";

/**
 * The application log's rules, without an Electron app and without a console.
 *
 * What matters here is not that a file appears — it is the three properties the
 * module exists for: the memory ring is bounded, the disk write is a queue
 * rather than a race, and a directory the process cannot write to costs a log
 * line instead of a launch.
 */

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "weaveforge-log-"));
}

function fakeConsole(): Pick<Console, "log" | "warn" | "error"> & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    log: (...args: unknown[]) => void seen.push(`log:${args.join(" ")}`),
    warn: (...args: unknown[]) => void seen.push(`warn:${args.join(" ")}`),
    error: (...args: unknown[]) => void seen.push(`error:${args.join(" ")}`),
  };
}

test("an entry is kept in memory and written to the file", async () => {
  const dir = await tempDir();
  const log = createAppLog({ dir });
  log.record({ level: "error", source: "request", message: "GET /x — 403", detail: "forbidden" });
  await log.flush();

  assert.equal(log.entries().length, 1);
  assert.equal(log.entries()[0]?.message, "GET /x — 403");
  assert.equal(log.entries()[0]?.detail, "forbidden");
  assert.equal(log.file(), path.join(dir, APP_LOG_FILENAME));

  const onDisk = await readFile(log.file(), "utf8");
  const first = JSON.parse(onDisk.trim().split("\n")[0]!) as { message: string; source: string };
  assert.equal(first.message, "GET /x — 403");
  assert.equal(first.source, "request");
});

test("the memory ring is bounded, and the newest entries are the ones kept", async () => {
  const dir = await tempDir();
  const log = createAppLog({ dir });
  for (let index = 0; index < MAX_ENTRIES + 25; index++) {
    log.record({ level: "info", source: "test", message: `line ${index}` });
  }
  await log.flush();
  assert.equal(log.entries().length, MAX_ENTRIES);
  assert.equal(log.entries()[MAX_ENTRIES - 1]?.message, `line ${MAX_ENTRIES + 24}`);
  // Every line still reached the file: the ring is a view bound, not a loss.
  const lines = (await readFile(log.file(), "utf8")).trim().split("\n");
  assert.equal(lines.length, MAX_ENTRIES + 25);
});

test("a 4,000-character message is clipped rather than written whole", async () => {
  const dir = await tempDir();
  const log = createAppLog({ dir });
  log.record({ level: "error", source: "request", message: "x".repeat(9_000) });
  await log.flush();
  const message = log.entries()[0]?.message ?? "";
  assert.ok(message.length < 9_000, "the message was not clipped");
  assert.match(message, /more\]$/);
});

test("console capture mirrors this process's own lines, once", async () => {
  const dir = await tempDir();
  const target = fakeConsole();
  const log = createAppLog({ dir, target });
  log.installConsoleCapture();
  // A second install must not wrap the wrapper: every line would be recorded
  // twice and printed twice, which is how a log becomes unreadable.
  log.installConsoleCapture();
  target.warn("local database did not open");
  assert.deepEqual(target.seen, ["warn:local database did not open"]);

  const warnings = log.entries().filter((entry) => entry.level === "warn");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.source, "main");
  assert.equal(warnings[0]?.message, "local database did not open");
});

test("an unwritable directory costs a log line, not a launch", async () => {
  // A path whose parent is a *file*: every mkdir and append fails. The module's
  // contract is that this is swallowed — a shell that will not start because its
  // log directory is read-only has turned diagnostics into an outage.
  const dir = await tempDir();
  const fileAhead = path.join(dir, "file");
  await writeFile(fileAhead, "x");
  const log = createAppLog({ dir: path.join(fileAhead, "under-a-file") });
  log.record({ level: "error", source: "test", message: "still recorded" });
  await log.flush();
  assert.equal(log.entries().length, 1);
  // And the memory answer is intact even though the disk one could not be.
  assert.equal(log.entries()[0]?.message, "still recorded");
});

/**
 * A fresh launch has to show the session that died.
 *
 * The bug this pins: the memory ring starts empty, so the first thing the panel
 * said on a new launch was "Nothing has been logged yet" — while the file beside
 * it held the whole previous session. That is the one moment the log is opened
 * for. The file is the record; the ring is a window onto it, and restoring is
 * what makes the window start somewhere useful.
 */
test("a new process reads the previous session's lines out of the file", async () => {
  const dir = await tempDir();
  const first = createAppLog({ dir });
  first.record({ level: "error", source: "request", message: "GET /a — 500" });
  first.record({ level: "warn", source: "main", message: "database slow" });
  await first.flush();

  const second = createAppLog({ dir });
  assert.equal(second.entries().length, 0, "a new log starts empty until it restores");
  await second.restoreFromDisk();
  assert.deepEqual(
    second.entries().map((entry) => entry.message),
    ["GET /a — 500", "database slow"],
  );
  // Restoring must not re-append: the file would otherwise grow on every launch.
  await second.flush();
  const lines = (await readFile(second.file(), "utf8")).trim().split("\n");
  assert.equal(lines.length, 2);
});

test("a half-written last line is dropped rather than guessed at", async () => {
  const dir = await tempDir();
  const log = createAppLog({ dir });
  await writeFile(
    log.file(),
    `${JSON.stringify({ at: "2026-01-01T00:00:00.000Z", level: "error", source: "test", message: "whole" })}\n{"at":"2026-01-01T00:00:01.000Z","lev`,
    "utf8",
  );
  await log.restoreFromDisk();
  assert.deepEqual(
    log.entries().map((entry) => entry.message),
    ["whole"],
  );
});

test("restoring twice does not duplicate what this process already said", async () => {
  const dir = await tempDir();
  const log = createAppLog({ dir });
  log.record({ level: "info", source: "test", message: "one line" });
  await log.flush();
  await log.restoreFromDisk();
  await log.restoreFromDisk();
  assert.equal(log.entries().length, 1);});

/**
 * Valid JSON that is not an entry.
 *
 * `null`, a number and an object with the wrong fields are all things a
 * truncated or hand-edited file can hold, and `JSON.parse` accepts every one of
 * them. Reading `.at` off one was an exception inside the `flatMap` — and a
 * throw inside a `flatMap` callback ends the whole map, so the lines after it
 * went with it. The shape is checked, not assumed.
 */
test("a line that parses but is not an entry is skipped, not fatal", async () => {
  const dir = await tempDir();
  const log = createAppLog({ dir });
  await writeFile(
    log.file(),
    [
      "null",
      "42",
      "[1,2,3]",
      '{"at":"nope"}',
      '{"message":"no timestamp"}',
      JSON.stringify({ at: "2026-01-01T00:00:00.000Z", level: "error", source: "test", message: "real" }),
      "not json at all",
    ].join("\n") + "\n",
    "utf8",
  );
  await log.restoreFromDisk();
  assert.deepEqual(
    log.entries().map((entry) => entry.message),
    ["real"],
  );
});

/**
 * Restoring never pushes the ring past its bound.
 *
 * The ring is the only place entries are held for the panel, and its whole
 * point is that a page in a retry loop cannot grow the process. A full file
 * plus this process's own lines was one line over the cap.
 */
test("restoring into a ring that already has entries stops at the cap", async () => {
  const dir = await tempDir();
  const writer = createAppLog({ dir });
  for (let index = 0; index < MAX_ENTRIES; index++) {
    writer.record({ level: "info", source: "old", message: `old ${index}` });
  }
  await writer.flush();

  const log = createAppLog({ dir });
  log.record({ level: "info", source: "new", message: "newest" });
  await log.restoreFromDisk();
  assert.equal(log.entries().length, MAX_ENTRIES);
  assert.equal(log.entries()[MAX_ENTRIES - 1]?.message, "newest");
  assert.equal(log.entries()[0]?.source, "old");
});
