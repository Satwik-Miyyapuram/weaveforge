import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_SESSION_MAX_TTL_MS,
  CreateAiSessionGrantUseCase,
  type AiAccessSettings,
} from "../src/index.js";

const settings: AiAccessSettings = {
  enabled: true,
  disclosureAcceptedAt: "2026-07-14T10:00:00.000Z",
  readCategories: ["paper_metadata"],
  proposalKinds: [],
};

test("creates an expiring grant for explicitly selected allowed sources", () => {
  const result = new CreateAiSessionGrantUseCase().execute({
    id: "session-1",
    workspaceName: "Literature review",
    settings,
    encryptionUnlocked: true,
    now: "2026-07-14T10:00:00.000Z",
    allowedTools: ["search_workspace", "get_workspace_outline"],
    proposalCapabilities: [],
    sources: [
      { sourceId: "paper:a", resourceType: "paper", resourceId: "a", label: "Paper A" },
      { sourceId: "paper:a", resourceType: "paper", resourceId: "a", label: "Paper A" },
    ],
  });

  assert.equal(result.workspace.sources.length, 1);
  assert.equal(result.grant.expiresAt, "2026-07-14T10:30:00.000Z");
  assert.equal(result.grant.requiresConfirmationForWrites, true);
});

test("fails closed for locked encryption, unavailable categories, and excessive ttl", () => {
  const useCase = new CreateAiSessionGrantUseCase();
  const input = {
    id: "session-1", workspaceName: "Test", settings, now: "2026-07-14T10:00:00.000Z",
    allowedTools: ["search_workspace"] as const, proposalCapabilities: [] as const,
    sources: [{ sourceId: "vault:a", resourceType: "vault_page" as const, resourceId: "a" }],
  };
  assert.throws(() => useCase.execute({ ...input, encryptionUnlocked: false }), /Unlock encryption/);
  assert.throws(() => useCase.execute({ ...input, encryptionUnlocked: true }), /not enabled/);

  const result = useCase.execute({
    ...input,
    encryptionUnlocked: true,
    sources: [{ sourceId: "paper:a", resourceType: "paper", resourceId: "a" }],
    ttlMs: AI_SESSION_MAX_TTL_MS * 2,
  });
  assert.equal(result.grant.expiresAt, "2026-07-21T10:00:00.000Z");
});
