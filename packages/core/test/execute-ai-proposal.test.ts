import assert from "node:assert/strict";
import test from "node:test";
import { ExecuteAiProposalUseCase, type AiWriteProposal } from "../src/index.js";

test("executor lifecycle persists the outcome and immutable audit entry", async () => {
  let proposal: AiWriteProposal = { id: "proposal-1", kind: "create_log_entry", resourceId: "00000000-0000-0000-0000-000000000001", content: "log", createdAt: "now", status: "pending", sourceLinks: [], payload: { body: "log" } };
  const audits: string[] = [];
  const useCase = new ExecuteAiProposalUseCase({
    proposals: { async save(value) { proposal = value; }, async getById() { return proposal; }, async listPending() { return [proposal]; } },
    audit: { async save(value) { audits.push(value.action); } },
    executors: { async execute() { return "accepted"; } }, ids: { newId: () => "audit-1" }, clock: { nowIso: () => "later" },
  });
  assert.equal(await useCase.execute(proposal.id), "accepted");
  assert.equal(proposal.status, "accepted");
  assert.deepEqual(audits, ["accepted"]);
});
