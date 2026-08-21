import assert from "node:assert/strict";
import test from "node:test";
import { retrieveAiExcerpts, type AiRetrievalDocument } from "../../../src/index.js";

const documents: AiRetrievalDocument[] = [
  { source: { sourceId: "paper:a", label: "Causal paper", resourceType: "paper", resourceId: "a", href: "/papers?paper=a" }, text: "Causal abstraction maps a neural network to a higher-level causal model." },
  { source: { sourceId: "vault:b", label: "Unrelated note", resourceType: "vault_page", resourceId: "b" }, text: "Meeting agenda and logistics for next week." },
];

test("retrieves only matching local documents with stable provenance", () => {
  const results = retrieveAiExcerpts(documents, "causal model");
  assert.equal(results.length, 1);
  assert.equal(results[0]?.source.sourceId, "paper:a");
  assert.equal(results[0]?.source.href, "/papers?paper=a");
  assert.equal(results[0]?.passageId, "paper:a:0");
  assert.match(results[0]?.text ?? "", /causal/i);
});

test("bounds excerpts and ignores an empty query", () => {
  assert.deepEqual(retrieveAiExcerpts(documents, " "), []);
  const long = [{ ...documents[0]!, text: `prefix ${"x".repeat(2_000)} causal result` }];
  const [result] = retrieveAiExcerpts(long, "causal", { maxChars: 200 });
  assert.ok((result?.text.length ?? 0) <= 202);
});
