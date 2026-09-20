import assert from "node:assert/strict";
import test from "node:test";

import { errorDetail } from "@/app/error-boundary-parts";
import { recentLogs, recordError, resetLogCaptureForTest } from "@/lib/error-report/log-buffer";

/**
 * What a report actually carries.
 *
 * Two gaps this closes, both found by asking what the payload contains rather than
 * whether the button works:
 *
 *   * `errorDetail` returned the message and the digest and stopped. The stack is
 *     the half a bug report is *for* — "Cannot read properties of undefined"
 *     without a frame tells whoever reads the issue nothing.
 *   * The console capture never saw an uncaught error, because a browser prints
 *     those itself rather than through `console.error`. The window handlers now
 *     record them, with the file and line.
 */

test("errorDetail carries the message, the digest and the stack", () => {
  const error = Object.assign(new Error("Cannot read properties of undefined (reading 'title')"), {
    digest: "1234567890",
  });

  const detail = errorDetail(error);

  assert.match(detail, /Cannot read properties of undefined/);
  assert.match(detail, /digest: 1234567890/);
  assert.match(detail, /at /, "the stack is the trace a report needs");
});

test("errorDetail tolerates an error with no stack of its own", () => {
  // Next strips the stack for some errors; the digest is then the only handle.
  const stripped = { message: "An error occurred in the Server Components render", digest: "abc" } as Error & {
    digest: string;
  };

  assert.equal(errorDetail(stripped), "An error occurred in the Server Components render\ndigest: abc");
});

test("errorDetail is empty rather than invented when there is no message", () => {
  assert.equal(errorDetail({ message: "" } as Error), "");
});

test("an uncaught error is recorded even though it never reached console.error", () => {
  resetLogCaptureForTest();

  recordError("TypeError: x is not a function\n    at papers/screen.tsx:41:9");

  const logs = recentLogs();
  assert.match(logs, /\[uncaught\]/, "marked, so it is not mistaken for a logged warning");
  assert.match(logs, /papers\/screen\.tsx:41:9/, "and it carries where it happened");

  resetLogCaptureForTest();
});

test("an empty record is a no-op", () => {
  resetLogCaptureForTest();
  recordError("");
  assert.equal(recentLogs(), "");
  resetLogCaptureForTest();
});
