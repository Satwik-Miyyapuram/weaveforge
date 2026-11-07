/**
 * The meaning-search status line: a desktop that fell back from its own encoder
 * to the browser's says so, and the plain ready line stays as it was.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { semanticStatusText } from "../ui/semantic-status-text";

test("a ready arm on the browser encoder after a native failure says so", () => {
  const text = semanticStatusText({ phase: "ready", passages: 3, model: "MiniLM", fallback: true });
  assert.match(text, /^On — 3 passages searchable by meaning \(MiniLM\)\./);
  assert.match(text, /The app's own encoder did not load, so the browser's is used\./);
});

test("a ready arm with no fallback has no fallback note", () => {
  const text = semanticStatusText({ phase: "ready", passages: 3, model: "MiniLM" });
  assert.equal(text, "On — 3 passages searchable by meaning (MiniLM). New and edited items are added as you work.");
});

test("the other phases keep their lines", () => {
  assert.equal(semanticStatusText({ phase: "loading" }), "Starting the model…");
  assert.equal(semanticStatusText({ phase: "off" }), "Waiting to start…");
  assert.equal(
    semanticStatusText({ phase: "error", message: "offline" }),
    "Not working: offline. Keyword search is unaffected.",
  );
});
