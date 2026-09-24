import assert from "node:assert/strict";
import test from "node:test";
import { installRequestLog, resetRequestLogForTest } from "../lib/error-report/request-log";
import { resetLogCaptureForTest } from "../lib/error-report/log-buffer";

/**
 * The request log's rules.
 *
 * The one that matters most is the clone: a global `fetch` wrapper that reads
 * the body it is reporting on would consume it, and every error path in the app
 * that calls `res.text()` or `res.json()` to explain itself would then get
 * "body already read" instead of the server's message. That would be a worse bug
 * than the one this file fixes, so it is pinned here.
 *
 * Everything here goes through `window.fetch()` rather than the bare `fetch`,
 * and that is not a style choice: in a browser they are the same function, but
 * in `node:test` the global `fetch` is Node's own and the wrapper only replaces
 * the window's. A test that called `fetch(...)` would be exercising undici and
 * would pass whatever the code did.
 */

type Report = { level: string; source: string; message: string; detail?: string };

/** The window's own fetch, which is the one the installer replaces. */
function browserFetch(input: string, init?: RequestInit): Promise<Response> {
  const impl = (globalThis as unknown as { window: { fetch: typeof fetch } }).window.fetch;
  return impl(input, init);
}

/** A window with a `fetch` and a bridge that records what is posted to it. */
function stubWindow(fetchImpl: typeof fetch, reports: Report[]): () => void {
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    fetch: fetchImpl,
    weaveforge: {
      // `desktop()` checks the bridge by shape, so a stub that cannot answer
      // this reads as "no bridge" and nothing would be reported at all.
      fetchTitle: () => Promise.resolve({}),
      reportAppLog: (entry: Report) => void reports.push(entry),
    },
  };
  return () => {
    resetRequestLogForTest();
    (globalThis as { window?: unknown }).window = originalWindow;
  };
}

/** Long enough for the cloned body's read and the report that follows it. */
const SETTLE_MS = 20;

test("a non-ok response is reported with its status, and the caller's body survives", async () => {
  const reports: Report[] = [];
  const restore = stubWindow(
    (async () =>
      new Response("forbidden: local API is off", { status: 403, statusText: "Forbidden" })) as typeof fetch,
    reports,
  );
  try {
    installRequestLog();
    const res = await browserFetch("https://api.weaveforge.org/rest/v1/papers");
    // The caller still gets its own body, unread. If the wrapper had consumed
    // it — the failure this test exists for — this line would say "body used
    // already" instead of the server's message.
    assert.equal(await res.text(), "forbidden: local API is off");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.level, "error");
    assert.equal(reports[0]?.source, "request");
    assert.match(reports[0]!.message, /GET https:\/\/api\.weaveforge\.org\/rest\/v1\/papers/);
    assert.match(reports[0]!.message, /403 Forbidden/);
    assert.match(reports[0]!.detail ?? "", /local API is off/);
  } finally {
    restore();
    resetLogCaptureForTest();
  }
});

test("a network failure is reported and the error is rethrown unchanged", async () => {
  const reports: Report[] = [];
  const boom = new TypeError("Failed to fetch");
  const restore = stubWindow((async () => Promise.reject(boom)) as typeof fetch, reports);
  try {
    installRequestLog();
    // The identity matters as much as the rejection: a wrapper that replaced the
    // error with its own would break every `err.message` a screen shows.
    await assert.rejects(browserFetch("https://api.weaveforge.org/x"), (error: unknown) => error === boom);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    assert.equal(reports.length, 1);
    assert.match(reports[0]!.message, /no response/);
    assert.match(reports[0]!.detail ?? "", /Failed to fetch/);
  } finally {
    restore();
    resetLogCaptureForTest();
  }
});

test("a successful response is not reported", async () => {
  const reports: Report[] = [];
  const restore = stubWindow((async () => new Response("ok", { status: 200 })) as typeof fetch, reports);
  try {
    installRequestLog();
    await browserFetch("https://api.weaveforge.org/x");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    assert.equal(reports.length, 0);
  } finally {
    restore();
    resetLogCaptureForTest();
  }
});

test("the app's own static assets are not noise in the log", async () => {
  const reports: Report[] = [];
  const restore = stubWindow(
    (async () => new Response("missing", { status: 404 })) as typeof fetch,
    reports,
  );
  try {
    installRequestLog();
    await browserFetch("/_next/static/chunks/1601.js");
    // The installed app asks for the same chunks under its own scheme, which is
    // the form the first version of the filter missed.
    await browserFetch("app://weaveforge/_next/static/chunks/1601.js");
    await browserFetch("http://localhost:3000/_next/static/chunks/1601.js");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    assert.equal(reports.length, 0);
  } finally {
    restore();
    resetLogCaptureForTest();
  }
});

test("installing twice does not report the same failure twice", async () => {
  const reports: Report[] = [];
  const restore = stubWindow(
    (async () => new Response("nope", { status: 500 })) as typeof fetch,
    reports,
  );
  try {
    installRequestLog();
    installRequestLog();
    await browserFetch("https://api.weaveforge.org/x");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    assert.equal(reports.length, 1);
  } finally {
    restore();
    resetLogCaptureForTest();
  }
});

/**
 * A body larger than the cap is cut off.
 *
 * The cap exists so a server pushing a megabyte of HTML at a failing request
 * cannot make the log hold it. A plain string body rather than a stream: in
 * `node:test` undici ties a streamed body to one consumer and `clone()` throws
 * on it, while in a browser a `Response` is always cloneable. The cap is what
 * is under test, not the clone, and a string body exercises the same `slice`.
 *
 * This test found a real hole when it was written the other way: a throw from
 * `clone()` escaped the report entirely, so a response that could not be cloned
 * was a failure that produced no log line at all.
 */
test("a body past the cap is cut off, and the report still arrives", async () => {
  const reports: Report[] = [];
  const restore = stubWindow(
    (async () => new Response("x".repeat(9_000), { status: 502, statusText: "Bad Gateway" })) as typeof fetch,
    reports,
  );
  try {
    installRequestLog();
    const res = await browserFetch("https://api.weaveforge.org/big");
    assert.equal(res.status, 502);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    assert.equal(reports.length, 1);
    assert.equal(reports[0]!.detail?.length, 2_000, "the detail is cut to the cap");
  } finally {
    restore();
    resetLogCaptureForTest();
  }
});

/**
 * A response whose body cannot be read at all is still reported.
 *
 * The report is the point; the body is a bonus. A `clone()` that throws — an
 * already-used body, a stream undici will not tee, a response from a service
 * worker that does not implement cloning — used to take the whole log line with
 * it, which is the one outcome this feature cannot afford.
 */
test("a body that cannot be cloned does not cost the report", async () => {
  const reports: Report[] = [];
  const restore = stubWindow(
    (async () => {
      const response = new Response("used", { status: 500 });
      // Read it, then hand it back: `clone()` on a disturbed body throws.
      await response.text();
      return response;
    }) as typeof fetch,
    reports,
  );
  try {
    installRequestLog();
    await browserFetch("https://api.weaveforge.org/x");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    assert.equal(reports.length, 1, "the failure was not logged at all");
    assert.match(reports[0]!.message, /500/);
  } finally {
    restore();
    resetLogCaptureForTest();
  }
});
