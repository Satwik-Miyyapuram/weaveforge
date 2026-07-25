import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AiAccessPolicy,
  AiQueryDeniedError,
  RunAiQueryUseCase,
  type AiAccessSettings,
  type AiSessionGrant,
  type AiSourceExcerpt,
} from "../src/index.js";

const settings: AiAccessSettings = {
  enabled: true,
  disclosureAcceptedAt: "2026-07-14T00:00:00.000Z",
  readCategories: ["paper_notes"],
  proposalKinds: [],
};
const grant: AiSessionGrant = {
  id: "grant-1",
  workspaceId: "workspace-1",
  expiresAt: "2026-07-15T00:00:00.000Z",
  readable: [{ sourceId: "source-1", resourceType: "paper_note", resourceId: "note-1", label: "Paper note" }],
  allowedTools: ["get_source_excerpt"],
  proposalCapabilities: [],
  requiresConfirmationForWrites: true,
};

test("read-only query grounds a model-neutral conversation with authorized excerpts", async () => {
  const excerpt: AiSourceExcerpt = {
    source: { sourceId: "source-1", resourceType: "paper_note", resourceId: "note-1", label: "Paper note" },
    text: "The paper evaluates a small cohort.",
  };
  let request: unknown;
  const result = await new RunAiQueryUseCase({
    policy: new AiAccessPolicy(),
    reader: { async read() { return excerpt; } },
    conversation: {
      async complete(input) {
        request = input;
        return { text: "Grounded answer", model: "test-model", provider: "custom", sourceLinks: [excerpt.source] };
      },
    },
  }).execute({
    question: "What was evaluated?",
    sources: [{ resourceType: "paper_note", resourceId: "note-1" }],
    settings,
    grant,
    encryptionUnlocked: true,
    now: "2026-07-14T12:00:00.000Z",
  });
  assert.equal(result.text, "Grounded answer");
  assert.match(JSON.stringify(request), /small cohort/);
});

test("read-only query fails closed before reading an ungranted source", async () => {
  let readCalled = false;
  const useCase = new RunAiQueryUseCase({
    policy: new AiAccessPolicy(),
    reader: { async read() { readCalled = true; return null; } },
    conversation: { async complete() { throw new Error("must not call model"); } },
  });
  await assert.rejects(
    useCase.execute({
      question: "Read this",
      sources: [{ resourceType: "paper_note", resourceId: "note-2" }],
      settings,
      grant,
      encryptionUnlocked: true,
      now: "2026-07-14T12:00:00.000Z",
    }),
    (error: unknown) => error instanceof AiQueryDeniedError && error.reason === "source_not_granted",
  );
  assert.equal(readCalled, false);
});
