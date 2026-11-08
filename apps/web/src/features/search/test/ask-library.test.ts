/**
 * Ask your library: search hits become numbered, fenced sources; the model's
 * [n] markers map back to the hits it cited.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { UNTRUSTED_CONTEXT_RULE, type AiModelRequest, type SearchHit } from "@weaveforge/core";

import { askLibrary, buildAskRequest, citedSources } from "../application/ask-library";

function hit(id: string, title: string, text?: string, page?: number): SearchHit {
  return {
    id,
    kind: "paper",
    entityId: id,
    title,
    href: `/papers/${id}`,
    score: 1,
    terms: [],
    ...(page != null ? { page } : {}),
    ...(text ? { excerpt: { text, highlights: [] } } : {}),
  } as SearchHit;
}

const HITS = [hit("a", "Attention", "Self-attention replaces recurrence.", 3), hit("b", "BERT", "Masked language modelling.")];

test("prompt numbers the sources and fences them with the nonce", () => {
  const req = buildAskRequest("What replaces recurrence?", HITS, "n0nce");
  const system = req.messages[0]!.content;
  const user = req.messages[1]!.content;
  assert.ok(system.includes(UNTRUSTED_CONTEXT_RULE));
  assert.ok(system.includes("<<context-n0nce>>"));
  assert.ok(user.includes("<<context-n0nce>>") && user.includes("<</context-n0nce>>"));
  assert.ok(user.includes("[1]\nAttention (p. 3)\nSelf-attention"));
  assert.ok(user.includes("[2]\nBERT"));
  assert.ok(user.includes("Self-attention replaces recurrence."));
  assert.ok(user.includes("What replaces recurrence?"));
});

test("a hit with no excerpt is still a source, by its title", () => {
  const user = buildAskRequest("q", [hit("c", "Only a title")], "x").messages[1]!.content;
  assert.ok(user.includes("[1]\nOnly a title"));
});

test("citedSources maps [n] markers to hits, in order, once each, ignoring out-of-range", () => {
  const cited = citedSources("See [2] and [1][2], not [3] or [0]. Also [1, 2].", HITS);
  assert.deepEqual(cited.map((s) => [s.n, s.hit.id]), [[2, "b"], [1, "a"]]);
});

test("no hits: answers without calling the model", async () => {
  let called = false;
  const result = await askLibrary({
    question: "anything",
    search: async () => [],
    model: { provider: "openai", complete: async () => ((called = true), { text: "", model: "m", provider: "openai", sourceLinks: [] }) },
  });
  assert.equal(called, false);
  assert.equal(result.sources.length, 0);
  assert.match(result.answer, /nothing/i);
});

test("asks the model with the question and returns its text with the cited hits", async () => {
  let seen: AiModelRequest | null = null;
  const result = await askLibrary({
    question: "What replaces recurrence?",
    search: async (q) => (q === "What replaces recurrence?" ? HITS : []),
    model: {
      provider: "openai",
      complete: async (req) => {
        seen = req;
        return { text: "Self-attention [1].", model: "m", provider: "openai", sourceLinks: [] };
      },
    },
  });
  assert.ok(seen);
  assert.equal(result.answer, "Self-attention [1].");
  assert.deepEqual(result.sources.map((s) => [s.n, s.hit.id]), [[1, "a"]]);
});
