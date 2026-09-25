import assert from "node:assert/strict";
import test from "node:test";

import { redact, redactAndCap } from "@/lib/error-report/redact";

/**
 * What may leave the building in a bug report.
 *
 * The failure this guards is not hypothetical: an error message quotes the URL it
 * failed on, a Supabase error carries its `detail`, a failed request prints its
 * headers, and a Windows stack trace carries the account name. Each of those is
 * useful in a report and none of them should be in a public issue.
 *
 * A pattern that does not match is worse than one that over-matches, so these
 * assert the *absence* of the secret as well as the presence of the marker.
 */

test("a JWT goes, in any position in the line", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const { text, redactions } = redact(`getSession failed: token=${jwt} for user`);

  assert.doesNotMatch(text, /eyJhbGciOiJIUzI1NiJ9/, "the header segment must not survive");
  assert.match(text, /<jwt>/);
  assert.equal(redactions, 1);
});

test("an authorization header keeps its scheme and loses its credential", () => {
  const { text } = redact("Request failed with headers: Authorization: Bearer sbp_abcdefghijklmnop");

  assert.doesNotMatch(text, /sbp_abcdefghijklmnop/);
  assert.match(text, /Bearer <redacted>/i, "the scheme is the diagnostic part");
});

test("provider keys go by their prefix", () => {
  for (const key of ["sk-live_abcdefghijklmnopqrst", "ghp_abcdefghijklmnopqrstuvwx", "github_pat_11ABCDEFG0abcdef"]) {
    const { text } = redact(`key is ${key}`);
    assert.doesNotMatch(text, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(text, /<key>|Bearer <redacted>/);
  }
});

test("a credential in a query string keeps its parameter name", () => {
  const { text } = redact("GET https://example.test/rest/v1/papers?select=id&apikey=secretvalue123&limit=5 failed");

  assert.doesNotMatch(text, /secretvalue123/);
  assert.match(text, /apikey=<redacted>/, "which parameter leaked is the useful half");
  assert.match(text, /limit=5/, "and the rest of the URL is untouched");
});

test("a home directory loses the account name", () => {
  const windows = redact("at C:\\Users\\satwik\\Documents\\MSc\\weaveforge\\apps\\web\\src\\boot.ts:12:5");
  const mac = redact("at /Users/satwik/code/apps/web/src/boot.ts:12:5");

  assert.doesNotMatch(windows.text, /satwik/);
  assert.match(windows.text, /C:\\Users\\<user>\\Documents/);
  assert.doesNotMatch(mac.text, /satwik/);
  assert.match(mac.text, /\/Users\/<user>\/code/);
});

test("an email address goes", () => {
  const { text } = redact("Zotero rejected the key for pandusatwik@gmail.com");

  assert.doesNotMatch(text, /pandusatwik@gmail\.com/);
  assert.match(text, /<email>/);
});

test("a long opaque blob goes, but prose does not", () => {
  const blob = "A".repeat(48);
  const { text } = redact(`payload=${blob} and then some ordinary words that are long but readable`);

  assert.doesNotMatch(text, new RegExp(blob));
  assert.match(text, /<blob>/);
  assert.match(text, /ordinary words that are long but readable/, "redaction must not eat the message");
});

test("a short hex id survives, a 64-character key does not", () => {
  // The line is deliberately fine: an id nobody can act on is not a secret, and
  // redacting everything opaque makes a report useless.
  const short = redact("row 4f2a1b failed");
  const long = redact(`dek=${"9f".repeat(32)}`);

  assert.match(short.text, /4f2a1b/);
  assert.doesNotMatch(long.text, /9f9f9f/);
});

test("an ordinary error message is untouched", () => {
  const message = "TypeError: Cannot read properties of undefined (reading 'title')";
  assert.deepEqual(redact(message), { text: message, redactions: 0 });
});

test("truncation is announced, not silent", () => {
  // Not `"x".repeat(…)`: a long unbroken run is exactly the shape the blob rule
  // removes, and the first draft of this test asserted its marker against text
  // that had already been redacted to `<blob>`.
  const trace = "    at renderScreen (apps/web/src/features/papers/ui/screen.tsx:41:9)\n".repeat(60);
  const { text } = redactAndCap(trace, 1_000);

  assert.ok(text.length < trace.length);
  assert.match(text, /truncated at 1000 characters \(\d+ more\)/, "a trace that just stops reads as the whole trace");
});
