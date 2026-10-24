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
  allowedTools: ["suggest_append_paper_note"], proposalCapabilities: ["append_paper_note"],
  requiresConfirmationForWrites: true,
};

test("the generic MCP draft command persists an encrypted-store-ready pending proposal", async () => {
  let stored: AiWriteProposal | undefined;
  const useCase = new CreateAiProposalDraftUseCase({
    policy: new AiAccessPolicy(),
    proposals: { async save(value) { stored = value; } },
    clock: { nowIso: () => "2026-07-14T12:00:00.000Z" },
  });

  const proposal = await useCase.execute({
    id: "proposal-1", kind: "append_paper_note", tool: "suggest_append_paper_note",
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
    proposals: { async save() { throw new Error("must not persist"); } },
    clock: { nowIso: () => "2026-07-14T12:00:00.000Z" },
  });

  await assert.rejects(
    useCase.execute({
      id: "proposal-2", kind: "create_log_entry", tool: "suggest_create_log_entry", resourceId: "proposal-2",
      content: "Create a log entry", payload: { body: "Draft" }, settings, grant, encryptionUnlocked: true,
      now: "2026-07-14T12:00:00.000Z",
    }),
    /AI proposal denied: tool_not_allowed/,
  );
});

// Ported from ProposeAppendPaperNoteUseCase (02-04): the MCP relay drafts
// append proposals through this command, so its checks are pinned here.
test("an append draft is stored trimmed, and an empty one is refused unsaved", async () => {
  const saved: AiWriteProposal[] = [];
  const useCase = new CreateAiProposalDraftUseCase({
    policy: new AiAccessPolicy(),
    proposals: { async save(value) { saved.push(value); } },
    clock: { nowIso: () => "2026-07-14T12:00:00.000Z" },
  });
  const draft = (content: string) => useCase.execute({
    id: "proposal-3", kind: "append_paper_note", tool: "suggest_append_paper_note",
    resourceId: "paper-1", resourceType: "paper_note", content, payload: { addition: content },
    settings, grant, encryptionUnlocked: true, now: "2026-07-14T12:00:00.000Z", expectedRevision: "rev-1",
  });

  const proposal = await draft("  AI suggestion  ");
  assert.equal(proposal.content, "AI suggestion");
  assert.equal(proposal.expectedRevision, "rev-1");
  assert.equal(proposal.createdAt, "2026-07-14T12:00:00.000Z");
  assert.deepEqual(proposal.sourceLinks, []);
  await assert.rejects(draft("   "), /preview is required/);
  assert.equal(saved.length, 1);
});

test("an append draft is refused while encryption is locked", async () => {
  const useCase = new CreateAiProposalDraftUseCase({
    policy: new AiAccessPolicy(),
    proposals: { async save() { throw new Error("must not persist"); } },
    clock: { nowIso: () => "2026-07-14T12:00:00.000Z" },
  });
  await assert.rejects(useCase.execute({
    id: "proposal-4", kind: "append_paper_note", tool: "suggest_append_paper_note",
    resourceId: "paper-1", resourceType: "paper_note", content: "x", payload: {},
    settings, grant, encryptionUnlocked: false, now: "2026-07-14T12:00:00.000Z",
  }), /AI proposal denied/);
});
