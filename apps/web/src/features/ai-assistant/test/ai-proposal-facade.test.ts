import assert from "node:assert/strict";
import test from "node:test";
import { AiProposalFacade } from "@/container/facades";
import { AiProposalExecutorRegistry } from "@thesis/core";
import type { AiWriteProposal } from "@thesis/core";

function draft(id = "proposal-1"): AiWriteProposal {
  return { id, kind: "append_paper_note", resourceId: "paper-1", content: "AI addition", createdAt: "2026-07-15T00:00:00.000Z", status: "pending", sourceLinks: [], expectedRevision: "rev-1" };
}

test("review facade approves append-only drafts and records the audit", async () => {
  let item = draft(); const audits: string[] = []; let note = "Existing";
  const facade = new AiProposalFacade({
    proposals: { async save(value) { item = value; }, async getById() { return item; }, async listPending() { return item.status === "pending" ? [item] : []; } },
    audit: { async save(record) { audits.push(record.action); } },
    executors: new AiProposalExecutorRegistry([{ kind: "append_paper_note", async execute(proposal) { note += `\n\n${proposal.content}`; return "accepted"; } }]),
    newId: () => "audit-1", now: () => "2026-07-15T00:01:00.000Z",
  });
  assert.equal(await facade.pendingCount(), 1);
  assert.equal(await facade.approve(item.id), "accepted");
  assert.equal(note, "Existing\n\nAI addition");
  assert.equal(item.status, "accepted");
  assert.deepEqual(audits, ["accepted"]);
});

test("review facade rejects without calling a workspace writer", async () => {
  let item = draft(); let wrote = false; const audits: string[] = [];
  const facade = new AiProposalFacade({
    proposals: { async save(value) { item = value; }, async getById() { return item; }, async listPending() { return [item]; } },
    audit: { async save(record) { audits.push(record.action); } },
    executors: new AiProposalExecutorRegistry([{ kind: "append_paper_note", async execute() { wrote = true; return "accepted"; } }]),
    newId: () => "audit-2", now: () => "2026-07-15T00:01:00.000Z",
  });
  await facade.reject(item.id);
  assert.equal(item.status, "rejected");
  assert.equal(wrote, false);
  assert.deepEqual(audits, ["rejected"]);
});
