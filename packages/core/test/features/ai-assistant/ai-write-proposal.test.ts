import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AiAccessPolicy,
  AppendPaperNoteUseCase,
  ConfirmAiProposalUseCase,
  ProposeAppendPaperNoteUseCase,
  appendPaperNote,
  proposalApplies,
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

// --- the append itself ------------------------------------------------------
//
// This decision used to be an object literal in the web composition root: the
// one place that decides whether an approved proposal still applies was also the
// only one that could not be tested without wiring the whole container. The
// revision comparison it contained was written out three times, so the copies —
// not the literal — were the finding.

function paperRepo(paper: { id: string; summary?: string; updatedAt: string } | null) {
  const writes: { summary: string; updatedAt: string }[] = [];
  return {
    writes,
    getById: async () => (paper ? { ...paper, title: "T", authors: [], status: "to_read" as const, tags: [], metadata: {}, createdAt: "2026-01-01T00:00:00.000Z" } : null),
    save: async (value: { summary?: string; updatedAt: string }) => {
      writes.push({ summary: value.summary ?? "", updatedAt: value.updatedAt });
      if (paper) paper.summary = value.summary;
    },
  };
}

test("an approved note appends to the summary and bumps the revision", async () => {
  const papers = paperRepo({ id: "p1", summary: "Existing note", updatedAt: "rev-1" });
  const appended = await new AppendPaperNoteUseCase({
    papers: papers as never,
    clock: { nowIso: () => "2026-07-14T12:00:00.000Z" },
  }).appendPaperNote({ paperId: "p1", addition: "AI suggestion", expectedRevision: "rev-1" });

  assert.equal(appended, "appended");
  assert.equal(papers.writes.length, 1);
  assert.equal(papers.writes[0]!.summary, "Existing note\n\nAI suggestion");
  assert.equal(papers.writes[0]!.updatedAt, "2026-07-14T12:00:00.000Z");
});

test("a paper that moved on is a conflict, and nothing is written", async () => {
  const papers = paperRepo({ id: "p1", summary: "Existing note", updatedAt: "rev-2" });
  const appended = await new AppendPaperNoteUseCase({
    papers: papers as never,
    clock: { nowIso: () => "2026-07-14T12:00:00.000Z" },
  }).appendPaperNote({ paperId: "p1", addition: "AI suggestion", expectedRevision: "rev-1" });

  assert.equal(appended, "conflicted");
  assert.deepEqual(papers.writes, [], "a conflict must not touch the paper");
});

test("a paper that no longer exists is a conflict, not a creation", async () => {
  const papers = paperRepo(null);
  const appended = await new AppendPaperNoteUseCase({
    papers: papers as never,
    clock: { nowIso: () => "2026-07-14T12:00:00.000Z" },
  }).appendPaperNote({ paperId: "gone", addition: "AI suggestion" });

  assert.equal(appended, "conflicted");
  assert.deepEqual(papers.writes, []);
});

test("a proposal with no expectation applies to whatever is there", () => {
  // The mistake this predicate exists to prevent: asking `updatedAt !== rev`
  // without first asking whether there *is* a rev makes every proposal without
  // one an unconditional conflict.
  assert.equal(proposalApplies({ updatedAt: "rev-9" }), true);
  assert.equal(proposalApplies({ updatedAt: "rev-9" }, "rev-9"), true);
  assert.equal(proposalApplies({ updatedAt: "rev-9" }, "rev-1"), false);
  assert.equal(proposalApplies(null, "rev-1"), false);
});

test("an empty expectation counts as no expectation", () => {
  // Preserved from all three copies: an empty string is not a revision anyone
  // meant, and treating it as one would start refusing proposals that used to be
  // applied.
  assert.equal(proposalApplies({ updatedAt: "rev-9" }, ""), true);
});
