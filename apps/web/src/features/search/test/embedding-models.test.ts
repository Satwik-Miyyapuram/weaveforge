import test from "node:test";
import assert from "node:assert/strict";
import {
  ARCTIC_EMBED_M,
  DEFAULT_EMBEDDING_MODEL,
  MINILM_L6,
  embeddingProfile,
  isKnownEmbeddingModel,
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

test("the default model is known, so a later upgrade can serve its vectors", () => {
  assert.equal(isKnownEmbeddingModel(DEFAULT_EMBEDDING_MODEL.id), true);
  assert.equal(targetEmbeddingModel().id, DEFAULT_EMBEDDING_MODEL.id);
});
