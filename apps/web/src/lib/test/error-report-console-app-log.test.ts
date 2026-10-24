/**
 * `console.error` reaches the shell's log file, not only the in-memory buffer
 * (xlog-01).
 *
 * Warnings and `console.log` stay out of the file, and a message repeated by a
 * render loop is written once.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { installConsoleCapture, recentLogs, resetLogCaptureForTest } from "@/lib/error-report/log-buffer";

type Report = { level: string; source: string; message: string; detail?: string };

/** Quiet printers, a bridge that records, and the capture over them. */
function withCapture(fn: (reports: Report[]) => void, bridge = true): Report[] {
  const reports: Report[] = [];
  const g = globalThis as { window?: unknown };
  const originalWindow = g.window;
  g.window = bridge
    ? {
        weaveforge: {
          fetchTitle: () => Promise.resolve({}),
          reportAppLog: (entry: Report) => void reports.push(entry),
        },
      }
    : {};
  resetLogCaptureForTest();
  const real = { error: console.error, warn: console.warn, log: console.log };
  console.error = () => {};
  console.warn = () => {};
  console.log = () => {};
  installConsoleCapture();
  try {
    fn(reports);
  } finally {
    resetLogCaptureForTest();
    Object.assign(console, real);
    g.window = originalWindow;
  }
  return reports;
}

test("console.error is written to the app log", () => {
  const reports = withCapture(() => console.error("Could not open note", { id: "n1" }));
  assert.equal(reports.length, 1);
  assert.equal(reports[0]!.level, "error");
  assert.equal(reports[0]!.source, "console");
  assert.match(reports[0]!.message, /Could not open note/);
});

test("an Error's stack goes in the detail, its first line in the message", () => {
  const reports = withCapture(() => console.error(new Error("boom")));
  assert.equal(reports.length, 1);
  assert.match(reports[0]!.message, /^Error: boom$/);
  assert.match(reports[0]!.detail ?? "", /at /);
});

test("warnings and console.log are not written to the file", () => {
  const reports = withCapture(() => {
    console.warn("deprecated prop");
    console.log("note title");
  });
  assert.equal(reports.length, 0);
});

test("the same error repeated is written once, and still buffered each time", () => {
  let buffered = "";
  const reports = withCapture(() => {
    for (let i = 0; i < 5; i++) console.error("render loop");
    buffered = recentLogs();
  });
  assert.equal(reports.length, 1);
  assert.equal(buffered.split("render loop").length - 1, 5);
});

test("with no desktop bridge, console.error still works and writes nothing", () => {
  let buffered = "";
  withCapture(() => {
    console.error("browser only");
    buffered = recentLogs();
  }, false);
  assert.match(buffered, /browser only/);
});

test("a bridge that throws does not break console.error", () => {
  const g = globalThis as { window?: unknown };
  const originalWindow = g.window;
  resetLogCaptureForTest();
  const realError = console.error;
  let printed = 0;
  console.error = () => void (printed += 1);
  g.window = {
    weaveforge: {
      fetchTitle: () => Promise.resolve({}),
      reportAppLog: () => {
        throw new Error("torn down");
      },
    },
  };
  installConsoleCapture();
  try {
    assert.doesNotThrow(() => console.error("still printed"));
    assert.equal(printed, 1);
  } finally {
    resetLogCaptureForTest();
    console.error = realError;
    g.window = originalWindow;
  }
});
