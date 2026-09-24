import assert from "node:assert/strict";
import test from "node:test";

import { readFailureReason } from "../application/index-library-pdfs";

/**
 * Why a PDF could not be read, in words a reader can act on.
 *
 * The loop that produces these reasons cannot be unit-tested here — it needs a
 * container, the network, pdf.js and IndexedDB — and that absence is exactly why
 * the bugs it had survived: a run finished with "Indexed 0, 18 could not be read"
 * and *no reason for any of them*, because the catch block discarded the error
 * and the result type had nowhere to put one. This is the piece worth testing on
 * its own.
 */
test("a refused cross-origin read is named as such, not as a dead network", () => {
  // What a browser reports for either, with nothing to tell them apart. The app
  // cannot fix a host's CORS policy, and the reader should not be left retrying.
  assert.equal(
    readFailureReason(new TypeError("Failed to fetch")),
    "the host does not allow this app to read its PDF (cross-origin)",
  );
  assert.equal(
    readFailureReason(new TypeError("NetworkError when attempting to fetch resource.")),
    "the host does not allow this app to read its PDF (cross-origin)",
  );
  assert.equal(
    readFailureReason(new TypeError("Load failed")),
    "the host does not allow this app to read its PDF (cross-origin)",
  );
});

test("an HTTP status is reported as the status", () => {
  // A 403 and a 404 are different problems; feeding the error body to pdf.js made
  // both of them a parse failure.
  assert.equal(readFailureReason(new Error("whatever"), 403), "the host answered 403");
  assert.equal(readFailureReason(new Error("whatever"), 404), "the host answered 404");
  assert.equal(readFailureReason(undefined, 500), "the host answered 500");
});

test("anything else keeps the error's own words", () => {
  // A real reason from further in — an invalid PDF, a parse failure — is more
  // useful than a category, so it is passed through rather than relabelled.
  assert.equal(readFailureReason(new Error("Invalid PDF structure")), "Invalid PDF structure");
  assert.equal(readFailureReason(new Error("The PDF had no pages")), "The PDF had no pages");
});

test("a thrown non-Error still yields something printable", () => {
  assert.equal(readFailureReason("plain string failure"), "plain string failure");
  assert.equal(readFailureReason(undefined), "undefined");
});
