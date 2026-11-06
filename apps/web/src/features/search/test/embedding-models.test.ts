import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ARCTIC_EMBED_M,
  DEFAULT_EMBEDDING_MODEL,
  MINILM_L6,
  embeddingProfile,
  planEmbeddingStart,
  targetEmbeddingModel,
} from "@/features/search/infrastructure/embedding-models";

test("the default encoder is the asymmetric retriever, with its query instruction", () => {
  assert.equal(DEFAULT_EMBEDDING_MODEL.id, ARCTIC_EMBED_M.id);
  assert.equal(ARCTIC_EMBED_M.pooling, "cls");
  assert.match(ARCTIC_EMBED_M.queryPrefix, /searching relevant passages/);
});

test("an unknown encoder is treated as symmetric and mean-pooled", () => {
  const profile = embeddingProfile("someone/unknown-encoder");
  assert.equal(profile.id, "someone/unknown-encoder");
  assert.equal(profile.pooling, "mean");
  assert.equal(profile.queryPrefix, "");
});

test("an upgrade serves the old vectors when the old model is still known", () => {
  assert.equal(planEmbeddingStart(MINILM_L6.id, ARCTIC_EMBED_M.id), "swap");
  assert.equal(planEmbeddingStart(ARCTIC_EMBED_M.id, ARCTIC_EMBED_M.id), "reuse");
  assert.equal(planEmbeddingStart(null, ARCTIC_EMBED_M.id), "rebuild");
  // A model no profile describes cannot be queried correctly, so it is not served.
  assert.equal(planEmbeddingStart("someone/retired-model", ARCTIC_EMBED_M.id), "rebuild");
});

test("the target model is the default", () => {
  assert.equal(targetEmbeddingModel().id, DEFAULT_EMBEDDING_MODEL.id);
});

// The desktop embeds with wf-store (Rust), the web with transformers.js. Vectors
// from one must match the other's queries, so both must pool and prefix alike.
test("the Rust embedder pools and prefixes each known model as the web does", () => {
  const rust = readFileSync(new URL("../../../../../../crates/wf-store/src/embed.rs", import.meta.url), "utf8");
  const constant = (name: string) => {
    const m = new RegExp(`const ${name}: &str = "([^"]*)";`).exec(rust);
    assert.ok(m, `embed.rs has no ${name}`);
    return m[1];
  };
  const arctic = constant("ARCTIC");
  const arcticPrefix = constant("ARCTIC_PREFIX");
  assert.match(rust, /if model_id == ARCTIC \{\s*Profile \{\s*pooling: Pooling::Cls,\s*query_prefix: ARCTIC_PREFIX,/);
  assert.match(rust, /\} else \{\s*Profile \{\s*pooling: Pooling::Mean,\s*query_prefix: "",/);
  // Rust never prefixes passages.
  assert.match(rust, /EmbedKind::Passage => cap_chars\(text\)\.to_string\(\),/);

  for (const web of [ARCTIC_EMBED_M, MINILM_L6, embeddingProfile("some/unknown-model")]) {
    const expected = web.id === arctic ? { pooling: "cls", queryPrefix: arcticPrefix } : { pooling: "mean", queryPrefix: "" };
    assert.deepEqual({ pooling: web.pooling, queryPrefix: web.queryPrefix }, expected, web.id);
    assert.equal(web.passagePrefix, "", web.id);
  }
  assert.equal(DEFAULT_EMBEDDING_MODEL.id, arctic, "the Rust embedder must know the default model");
});
