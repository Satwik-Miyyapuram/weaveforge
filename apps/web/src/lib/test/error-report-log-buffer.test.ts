import assert from "node:assert/strict";
import test from "node:test";

import {
  installConsoleCapture,
  recentLogs,
  resetLogCaptureForTest,
} from "@/lib/error-report/log-buffer";

/**
 * What the console buffer keeps, and — more to the point — what it does not.
 *
 * A report is filed on a public tracker. `console.log` in this app prints note
 * titles, fetched abstracts and entity ids, so the collector takes errors and
 * warnings only. That property is the reason this file exists; the rest is a ring
 * buffer.
 */

/**
 * Capture inside `fn`, quietly, and leave the console as it was found.
 *
 * The no-op printers are installed *before* the capture, so the capture wraps
 * them. Silencing afterwards would replace the wrapper itself, so nothing would be
 * recorded — which is how the first draft of this file managed to assert that a
 * message had not been logged when in fact nothing ever was.
 */
function withCapture(fn: () => void): void {
  resetLogCaptureForTest();
  const realError = console.error;
  const realWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  installConsoleCapture();
  try {
    fn();
  } finally {
    // Puts the quiet printers back…
    resetLogCaptureForTest();
    // …and then the real ones.
    console.error = realError;
    console.warn = realWarn;
  }
}

test("errors and warnings are kept, console.log is not", () => {
  withCapture(() => {
    console.error("a failure");
    console.warn("a warning");
    console.log("Note: Boiling water — abstract text nobody should publish");

    const logs = recentLogs();
    assert.match(logs, /a failure/);
    assert.match(logs, /a warning/);
    assert.doesNotMatch(logs, /Boiling water/, "console.log is not report material");
  });
});

test("an Error is kept with its stack", () => {
  withCapture(() => {
    console.error(new Error("the worker would not start"));
    assert.match(recentLogs(), /Error: the worker would not start/);
    assert.match(recentLogs(), /at /, "the stack is the useful half");
  });
});

test("an object becomes something readable rather than [object Object]", () => {
  withCapture(() => {
    console.error("fetch failed", { status: 502, url: "https://example.test" });
    assert.match(recentLogs(), /status.*502/);
  });
});

test("the buffer is bounded, keeping the newest lines", () => {
  withCapture(() => {
    for (let i = 0; i < 60; i += 1) console.error(`line ${i}`);
    const logs = recentLogs();
    assert.doesNotMatch(logs, /\bline 0\b/, "the oldest lines are dropped");
    assert.match(logs, /line 59/, "and the newest is kept");
  });
});

test("installing twice does not double-record", () => {
  withCapture(() => {
    installConsoleCapture();
    console.error("once only");
    assert.equal(
      recentLogs().split("once only").length - 1,
      1,
      "a second install must be a no-op, not another wrapper around the first",
    );
  });
});
