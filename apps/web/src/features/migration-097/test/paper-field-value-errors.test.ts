import assert from "node:assert/strict";
import { before, test } from "node:test";
import { NotFoundError } from "@weaveforge/core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { createPaperFieldsWriter, valueWriteError } from "../infrastructure/kind-writer-paper-fields";
import { MemorySink } from "../infrastructure/memory-sink";
import type { Row } from "../domain/ports";

before(loadTestCore);

const FOLDERS = new Map([["proj-a", "Thesis"]]);
const VALUE: Row = { id: "p1:fa", paperId: "p1", fieldId: "fa", projectId: "proj-a", value: "x" };

test("paper field values: a missing paper or definition gives the not-found message", async () => {
  const writer = createPaperFieldsWriter(new MemorySink(), FOLDERS);
  await assert.rejects(writer.write("paperFieldValues", VALUE), {
    message: "paper field value: no paper or definition for it",
  });
});

test("paper field values: a not-found keeps its message", () => {
  const err = valueWriteError(new NotFoundError('No paper with id "p1".'));
  assert.equal(err.message, "paper field value: no paper or definition for it");
});

test("paper field values: any other failure gives the fixed write-failed code, never the sink's text", () => {
  const err = valueWriteError(new Error("EIO: disk gone at Thesis/secret.paper.md")) as Error & { code?: string };
  assert.equal(err.message, "paper field value: write failed");
  assert.equal(err.code, "paper-value-write-failed");
});
