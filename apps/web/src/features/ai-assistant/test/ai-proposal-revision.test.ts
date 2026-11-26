import assert from "node:assert/strict";
import test from "node:test";
import { AiAssistantFacade } from "@/container/facades";
import type { AiAccessSettings, AiProposalKind, AiToolName, AiWriteProposal, Paper } from "@weaveforge/core";

// A proposal that edits a paper must remember the revision it was drafted
// against, or approving it later overwrites whatever the user changed since.
// MCP agents never see a revision, so the browser stamps the current one.

const PAPER = {
  id: "paper-1", title: "Attention", authors: ["A"], year: 2017, venue: "NeurIPS",
  abstract: "An abstract.", status: "reading", tags: [], summary: "note body",
  updatedAt: "2026-01-01T10:00:00.000Z",
} as unknown as Paper;

const KINDS: readonly AiProposalKind[] = ["append_paper_note", "paper_update", "paper_field_value"];
const TOOLS: readonly AiToolName[] = ["suggest_append_paper_note", "suggest_paper_update", "suggest_paper_field_value"];

const settings: AiAccessSettings = {
  enabled: true,
  disclosureAcceptedAt: "2026-01-01T00:00:00.000Z",
  readCategories: ["paper_metadata", "paper_notes"],
  proposalKinds: [...KINDS],
};

const empty = { async list() { return []; } };

async function session(paper: Paper | null = PAPER) {
  const saved: AiWriteProposal[] = [];
  const ai = new AiAssistantFacade({
    papers: { async list() { return [PAPER]; }, async getById() { return paper; } } as never,
    vaultPages: empty as never, readingLists: empty as never, logEntries: empty as never,
    experiments: empty as never, milestones: empty as never,
    proposals: { async save(p: AiWriteProposal) { saved.push(p); }, async getById() { return null; }, async listPending() { return []; } } as never,
    isEncryptionUnlocked: () => true,
    newId: () => `id-${saved.length}`,
    now: () => "2026-01-02T00:00:00.000Z",
    allowedTools: TOOLS,
  });
  const options = await ai.listSourceOptions();
  const active = await ai.startSession({
    workspaceName: "w", sourceIds: options.map((o) => o.sourceId), settings, proposalCapabilities: [...KINDS],
  });
  return { ai, sessionId: active.grant.id, saved };
}

const DRAFTS = [
  { kind: "append_paper_note", tool: "suggest_append_paper_note", resourceType: "paper_note" },
  { kind: "paper_update", tool: "suggest_paper_update", resourceType: "paper" },
  { kind: "paper_field_value", tool: "suggest_paper_field_value", resourceType: undefined },
] as const;

for (const draft of DRAFTS) {
  test(`${draft.kind} without expectedRevision is saved with the paper's current revision`, async () => {
    const { ai, sessionId, saved } = await session();
    await ai.proposeDraft({
      sessionId, settings, kind: draft.kind, tool: draft.tool, content: "change",
      payload: {}, resourceId: "paper-1", resourceType: draft.resourceType,
    });
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.expectedRevision, PAPER.updatedAt);
  });
}

test("an expectedRevision the caller gave is kept, not replaced by the current one", async () => {
  const { ai, sessionId, saved } = await session();
  await ai.proposeDraft({
    sessionId, settings, kind: "append_paper_note", tool: "suggest_append_paper_note", content: "change",
    payload: {}, resourceId: "paper-1", resourceType: "paper_note", expectedRevision: "older",
  });
  assert.equal(saved[0]?.expectedRevision, "older");
});

test("a paper edit for a paper that does not exist is refused and nothing is saved", async () => {
  const { ai, sessionId, saved } = await session(null);
  await assert.rejects(() => ai.proposeDraft({
    sessionId, settings, kind: "paper_update", tool: "suggest_paper_update", content: "change",
    payload: {}, resourceId: "paper-1", resourceType: "paper",
  }), /paper/i);
  assert.equal(saved.length, 0);
});
