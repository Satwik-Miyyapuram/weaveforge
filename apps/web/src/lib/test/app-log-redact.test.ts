import assert from "node:assert/strict";
import test from "node:test";

import { reportFailedRequest } from "@/lib/error-report/app-log";

/**
 * A failed request is written to the desktop log file as it happened, and that
 * file is what a person attaches to a bug report. Its URL can carry a blob view
 * token (`?t=`) or an OAuth code, and its error or body can quote a bearer
 * token, so the line is redacted before it leaves the page (xlog-02).
 */

type Report = { level: string; source: string; message: string; detail?: string };

function capture(run: () => void): Report {
  const reports: Report[] = [];
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    weaveforge: {
      fetchTitle: () => Promise.resolve({}),
      reportAppLog: (entry: Report) => void reports.push(entry),
    },
  };
  try {
    run();
  } finally {
    (globalThis as { window?: unknown }).window = original;
  }
  assert.equal(reports.length, 1);
  return reports[0]!;
}

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVlLWhlcmU";

test("a blob view token in the URL is redacted, the route kept", () => {
  const report = capture(() =>
    reportFailedRequest({ method: "get", url: "https://app.test/api/blobs/content?t=v1.abcdef123456.sig", status: 403 }),
  );
  assert.equal(report.message, "GET https://app.test/api/blobs/content?t=<redacted> — 403");
});

test("an OAuth code and an access token in the query are redacted", () => {
  const report = capture(() =>
    reportFailedRequest({
      method: "POST",
      url: "https://app.test/auth/callback?state=ok&code=4/0AbCdEf&access_token=secretvalue",
      status: 400,
      statusText: "Bad Request",
    }),
  );
  assert.equal(
    report.message,
    "POST https://app.test/auth/callback?state=ok&code=<redacted>&access_token=<redacted> — 400 Bad Request",
  );
});

test("a bearer token quoted by the error is redacted from the detail", () => {
  const error = new TypeError("Failed to fetch with Authorization: Bearer abcdefghijklmnopqrstuvwxyz");
  const report = capture(() => reportFailedRequest({ method: "GET", url: "https://api.test/rest/v1/papers", error }));
  assert.ok(report.detail);
  assert.doesNotMatch(report.detail, /abcdefghijklmnop/);
  assert.match(report.detail, /Bearer <redacted>/);
});

test("a JWT in the response body is redacted from the detail", () => {
  const report = capture(() =>
    reportFailedRequest({ method: "GET", url: "https://api.test/x", status: 401, body: `{"token":"${JWT}"}` }),
  );
  assert.equal(report.detail, '{"token":"<jwt>"}');
});

test("a secret cut by the body cap is still redacted", () => {
  // Cutting first would leave a JWT head too short for the JWT rule to see.
  const body = `${"word ".repeat(396)}${JWT}`;
  const report = capture(() => reportFailedRequest({ method: "GET", url: "https://api.test/x", status: 500, body }));
  assert.ok(report.detail);
  assert.doesNotMatch(report.detail, /eyJ/);
  assert.ok(report.detail.length <= 2_000);
});

test("an ordinary failure is logged unchanged", () => {
  const report = capture(() =>
    reportFailedRequest({ method: "GET", url: "https://api.test/rest/v1/papers?select=id", status: 404, body: "not found" }),
  );
  assert.deepEqual(report, {
    level: "error",
    source: "request",
    message: "GET https://api.test/rest/v1/papers?select=id — 404",
    detail: "not found",
  });
});
