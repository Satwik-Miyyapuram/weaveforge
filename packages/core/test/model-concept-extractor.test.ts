import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelConceptExtractor,
  parseExtractionJson,
  toExtractionResult,
  type AiModelRequest,
  type AiModelResponse,
  type ExtractionDocument,
  type IModelConversation,
} from "../src/index.js";

const DOCS: ExtractionDocument[] = [
  { id: "d1", title: "Attention", text: "We use multi-head attention throughout." },
  { id: "d2", title: "Baselines", text: "The baseline is an LSTM with attention." },
];

function fakeModel(
  reply: string | ((request: AiModelRequest) => string),
): IModelConversation & { calls: AiModelRequest[] } {
  const calls: AiModelRequest[] = [];
  return {
    calls,
    provider: "fake",
    async complete(request: AiModelRequest): Promise<AiModelResponse> {
      calls.push(request);
      return {
        text: typeof reply === "function" ? reply(request) : reply,
        model: "fake",
        provider: "fake",
        sourceLinks: [],
      };
    },
  };
}

const REPLY = JSON.stringify({
  concepts: [
    { name: "Attention", aliases: ["Self-Attention"], kind: "method", documentIds: ["d1", "d2"], evidence: "multi-head attention" },
    { name: "LSTM", aliases: [], kind: "method", documentIds: ["d2"], evidence: "an LSTM" },
  ],
});

test("concepts come back with document ids as mentions", async () => {
  const model = fakeModel(REPLY);
  const result = await new ModelConceptExtractor(model).extract({ documents: DOCS });

  assert.deepEqual(result.concepts.map((c) => c.name), ["Attention", "LSTM"]);
  assert.equal(result.concepts[0]!.mentions, 2);
  assert.deepEqual(result.concepts[0]!.aliases, ["Self-Attention"]);
  assert.equal(result.mentions.length, 3);
});

test("JSON survives a code fence and a preamble", () => {
  const wrapped = "Sure! Here you go:\n```json\n" + REPLY + "\n```\nHope that helps.";
  const parsed = parseExtractionJson(wrapped);
  assert.equal(parsed.length, 2);
});

test("a brace inside a string does not end the object early", () => {
  const text = '{"concepts":[{"name":"a }{ b","aliases":[],"kind":"concept","documentIds":["d1"]}]}';
  const parsed = parseExtractionJson(text);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.name, "a }{ b");
});

test("an escaped quote does not end the string early", () => {
  const text = '{"concepts":[{"name":"say \\"hi\\"","aliases":[],"kind":"concept","documentIds":["d1"]}]}';
  assert.equal(parseExtractionJson(text)[0]!.name, 'say "hi"');
});

test("an unparseable reply yields nothing rather than throwing", async () => {
  const result = await new ModelConceptExtractor(fakeModel("I cannot help with that.")).extract({
    documents: DOCS,
  });
  assert.deepEqual(result.concepts, []);
});

test("a hallucinated document id is discarded, not attached", () => {
  const result = toExtractionResult(
    [
      { name: "Ghost", aliases: [], kind: "concept", documentIds: ["nope"], evidence: "" },
      { name: "Real", aliases: [], kind: "concept", documentIds: ["d1", "nope"], evidence: "" },
    ],
    DOCS,
  );

  assert.deepEqual(result.concepts.map((c) => c.name), ["Real"], "a concept with no valid id is dropped");
  assert.equal(result.concepts[0]!.mentions, 1, "only real ids count as mentions");
  assert.deepEqual(result.mentions.map((m) => m.documentId), ["d1"]);
});

test("an unknown kind falls back rather than propagating", () => {
  const result = toExtractionResult(
    [{ name: "X", aliases: [], kind: "nonsense", documentIds: ["d1"] }],
    DOCS,
  );
  assert.equal(result.concepts[0]!.kind, "concept");
});

test("an alias identical to the name is not repeated", () => {
  const result = toExtractionResult(
    [{ name: "VAE", aliases: ["vae", "Variational Autoencoder"], kind: "method", documentIds: ["d1"] }],
    DOCS,
  );
  assert.deepEqual(result.concepts[0]!.aliases, ["Variational Autoencoder"]);
});

test("concepts already in the wiki are not proposed again", async () => {
  const result = await new ModelConceptExtractor(fakeModel(REPLY)).extract({
    documents: DOCS,
    existingConcepts: ["attention"],
  });
  assert.deepEqual(result.concepts.map((c) => c.name), ["LSTM"]);
  assert.ok(result.mentions.every((m) => m.conceptName === "LSTM"));
});

test("documents are batched, and counts merge across batches", async () => {
  const many: ExtractionDocument[] = Array.from({ length: 5 }, (_, i) => ({
    id: `d${i}`,
    title: `Doc ${i}`,
    text: "attention",
  }));

  const model = fakeModel((request) => {
    const ids = [...request.messages[1]!.content.matchAll(/--- id: (\S+)/g)].map((m) => m[1]);
    return JSON.stringify({
      concepts: [{ name: "Attention", aliases: [], kind: "method", documentIds: ids, evidence: "attention" }],
    });
  });

  const result = await new ModelConceptExtractor(model, { batchSize: 2 }).extract({ documents: many });

  assert.equal(model.calls.length, 3, "5 documents at 2 per call");
  assert.equal(result.concepts.length, 1, "the same concept from each batch is one concept");
  assert.equal(result.concepts[0]!.mentions, 5, "counts sum across batches");
});

test("a failing batch costs its own documents, not the run", async () => {
  let call = 0;
  const model: IModelConversation = {
    provider: "fake",
    async complete(): Promise<AiModelResponse> {
      call += 1;
      if (call === 1) throw new Error("rate limited");
      return {
        text: JSON.stringify({
          concepts: [{ name: "Kept", aliases: [], kind: "concept", documentIds: ["d2"], evidence: "" }],
        }),
        model: "fake",
        provider: "fake",
        sourceLinks: [],
      };
    },
  };

  const result = await new ModelConceptExtractor(model, { batchSize: 1 }).extract({ documents: DOCS });
  assert.deepEqual(result.concepts.map((c) => c.name), ["Kept"]);
});

test("empty documents are never sent", async () => {
  const model = fakeModel(REPLY);
  await new ModelConceptExtractor(model).extract({
    documents: [{ id: "d0", title: "Empty", text: "   " }],
  });
  assert.equal(model.calls.length, 0);
});

test("existing concepts are named in the prompt so the model reuses them", async () => {
  const model = fakeModel(REPLY);
  await new ModelConceptExtractor(model).extract({
    documents: DOCS,
    existingConcepts: ["Transformer"],
  });
  assert.match(model.calls[0]!.messages[1]!.content, /Transformer/);
});

test("maxConcepts trims concepts and their mentions together", async () => {
  const result = await new ModelConceptExtractor(fakeModel(REPLY)).extract({
    documents: DOCS,
    maxConcepts: 1,
  });
  assert.equal(result.concepts.length, 1);
  assert.ok(result.mentions.every((m) => m.conceptName === result.concepts[0]!.name));
});
