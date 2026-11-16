import { test } from "node:test";
import assert from "node:assert/strict";
import { formatError } from "../format-error";

// Deliberately no loadTestCore: this file runs in its own process, so the Rust
// core is never initialised here. formatError must still answer, falling back
// to the browser's own words rather than throwing from inside error reporting.

test("a network failure is shown as plain text when the Rust core is not loaded", () => {
  const message = formatError(new TypeError("Failed to fetch"));
  assert.equal(typeof message, "string");
  // The browser's words without the core; the friendly line if a module loaded it.
  assert.match(message, /Failed to fetch|Could not reach the server/);
});
