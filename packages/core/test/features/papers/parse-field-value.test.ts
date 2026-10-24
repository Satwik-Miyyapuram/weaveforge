/**
 * One reader for a paper field value sent by an AI tool (32-09): the MCP relay
 * and the approval executor both use it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePaperFieldValue } from "../../../src/features/papers/domain/paper-field.js";

test("strings, numbers and string lists pass; lists are trimmed", () => {
  assert.equal(parsePaperFieldValue("VAE", "value"), "VAE");
  assert.equal(parsePaperFieldValue(0, "value"), 0);
  assert.deepEqual(parsePaperFieldValue([" a ", "", "b"], "value"), ["a", "b"]);
});

test("anything else is refused with the caller's name", () => {
  for (const bad of ["  ", [], ["", " "], [1], Number.NaN, Infinity, null, undefined, {}, true]) {
    assert.throws(() => parsePaperFieldValue(bad, "Proposal value"), /^Error: Proposal value must be a non-empty string, number, or non-empty string list\.$/);
  }
});
