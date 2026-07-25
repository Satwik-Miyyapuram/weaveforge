import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AiAccessPolicy,
  ConfirmAiProposalUseCase,
  ProposeAppendPaperNoteUseCase,
  appendPaperNote,
  type AiAccessSettings,
  type AiSessionGrant,
  type AiWriteProposal,
} from "../src/index.js";

const settings: AiAccessSettings = {
  enabled: true,
  disclosureAcceptedAt: "2026-07-14T00:00:00.000Z",
  readCategories: ["paper_notes"],
  proposalKinds: ["append_paper_note"],
};
const grant: AiSessionGrant = {
  id: "grant-1", workspaceId: "workspace-1", expiresAt: "2026-07-15T00:00:00.000Z",
  readable: [{ sourceId: "source-1", resourceType: "paper_note", resourceId: "paper-1" }],
  allowedTools: ["propose_append_paper_note"], proposalCapabilities: ["append_paper_note"], requiresConfirmationForWrites: true,
};

test("paper note additions are append-only", () => {
  assert.equal(appendPaperNote("Existing note", "AI addition"), "Existing note\n\nAI addition");
  assert.equal(appendPaperNote(undefined, "AI addition"), "AI addition");
  assert.throws(() => appendPaperNote("Existing note", "  "));
});

test("proposal creation stores a pending append proposal", async () => {
  let stored: AiWriteProposal | undefined;
  const proposal = await new ProposeAppendPaperNoteUseCase({
    policy: new AiAccessPolicy(),
    proposals: { async save(value) { stored = value; }, async getById() { return stored ?? null; }, async listPending() { return stored ? [stored] : []; } },
    clock: { nowIso: () => "2026-07-14T12:00:00.000Z" },
  }).execute({
    id: "proposal-1", paperId: "paper-1", addition: "AI suggestion", settings, grant,
    encryptionUnlocked: true, now: "2026-07-14T12:00:00.000Z",
  });
  assert.equal(proposal.status, "pending");
  assert.equal(stored?.content, "AI suggestion");
});

test("confirmation appends only when the expected revision still matches and records an audit", async () => {
  let stored: AiWriteProposal = {
    id: "proposal-1", kind: "append_paper_note", resourceId: "paper-1", content: "AI suggestion",
    createdAt: "2026-07-14T12:00:00.000Z", status: "pending", sourceLinks: [], expectedRevision: "rev-1",
  };
  let appended = "Existing note";
  const audits: string[] = [];
  const confirmer = new ConfirmAiProposalUseCase({
    proposals: { async save(value) { stored = value; }, async getById() { return stored; }, async listPending() { return [stored]; } },
    paperNotes: { async appendPaperNote({ addition }) { appended = appendPaperNote(appended, addition); return "appended"; } },
    audit: { async save(record) { audits.push(record.action); } },
    ids: { newId: () => "audit-1" }, clock: { nowIso: () => "2026-07-14T12:01:00.000Z" },
  });
  assert.equal(await confirmer.execute("proposal-1"), "accepted");
  assert.equal(appended, "Existing note\n\nAI suggestion");
  assert.equal(stored.status, "accepted");
  assert.deepEqual(audits, ["accepted"]);
});

test("a revision conflict preserves the existing paper note", async () => {
  let stored: AiWriteProposal = { id: "proposal-1", kind: "append_paper_note", resourceId: "paper-1", content: "AI suggestion", createdAt: "now", status: "pending", sourceLinks: [], expectedRevision: "old" };
  const confirmer = new ConfirmAiProposalUseCase({
    proposals: { async save(value) { stored = value; }, async getById() { return stored; }, async listPending() { return [stored]; } },
    paperNotes: { async appendPaperNote() { return "conflicted"; } },
    audit: { async save() {} }, ids: { newId: () => "audit-1" }, clock: { nowIso: () => "now" },
  });
  assert.equal(await confirmer.execute("proposal-1"), "conflicted");
  assert.equal(stored.status, "conflicted");
});
