import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AiAccessPolicy,
  CreateAiProposalDraftUseCase,
  type AiAccessSettings,
  type AiSessionGrant,
  type AiWriteProposal,
} from "../../../src/index.js";

const settings: AiAccessSettings = {
  enabled: true,
  disclosureAcceptedAt: "2026-07-14T00:00:00.000Z",
  readCategories: ["paper_notes"],
  proposalKinds: ["append_paper_note"],
};
const grant: AiSessionGrant = {
  id: "grant-1", workspaceId: "workspace-1", expiresAt: "2026-07-15T00:00:00.000Z",
  readable: [{ sourceId: "paper-note:paper-1", resourceType: "paper_note", resourceId: "paper-1" }],
  allowedTools: ["propose_append_paper_note"], proposalCapabilities: ["append_paper_note"],
  requiresConfirmationForWrites: true,
};

test("the generic MCP draft command persists an encrypted-store-ready pending proposal", async () => {
  let stored: AiWriteProposal | undefined;
  const useCase = new CreateAiProposalDraftUseCase({
    policy: new AiAccessPolicy(),
    proposals: { async save(value) { stored = value; }, async getById() { return stored ?? null; }, async listPending() { return stored ? [stored] : []; } },
    clock: { nowIso: () => "2026-07-14T12:00:00.000Z" },
  });

  const proposal = await useCase.execute({
    id: "proposal-1", kind: "append_paper_note", tool: "propose_append_paper_note",
    resourceId: "paper-1", resourceType: "paper_note", content: "Append to paper note:\n\nDraft addition",
    payload: { addition: "Draft addition" }, settings, grant, encryptionUnlocked: true,
    now: "2026-07-14T12:00:00.000Z",
  });

  assert.equal(proposal.status, "pending");
  assert.deepEqual(stored?.payload, { addition: "Draft addition" });
  assert.equal(stored?.content, "Append to paper note:\n\nDraft addition");
});

test("the generic MCP draft command refuses a proposal whose capability was not granted", async () => {
  const useCase = new CreateAiProposalDraftUseCase({
    policy: new AiAccessPolicy(),
    proposals: { async save() { throw new Error("must not persist"); }, async getById() { return null; }, async listPending() { return []; } },
    clock: { nowIso: () => "2026-07-14T12:00:00.000Z" },
  });

  await assert.rejects(
    useCase.execute({
      id: "proposal-2", kind: "create_log_entry", tool: "propose_create_log_entry", resourceId: "proposal-2",
      content: "Create a log entry", payload: { body: "Draft" }, settings, grant, encryptionUnlocked: true,
      now: "2026-07-14T12:00:00.000Z",
    }),
    /AI proposal denied: tool_not_allowed/,
  );
});
