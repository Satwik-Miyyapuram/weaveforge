import assert from "node:assert/strict";
import test from "node:test";
import { AiProposalExecutorRegistry, type AiProposalKind, type AiWriteProposal } from "@thesis/core";
import { createAiProposalExecutors } from "../application/proposal-executors";

const draft = (kind: AiProposalKind, payload: Record<string, unknown>): AiWriteProposal => ({ id: `proposal-${kind}`, kind, resourceId: "paper-1", content: "Append this", createdAt: "2026-07-15T00:00:00.000Z", status: "pending", sourceLinks: [], payload });

test("every proposal kind is handled by the browser-only executor registry", async () => {
  const calls: string[] = [];
  const registry = new AiProposalExecutorRegistry(createAiProposalExecutors({
    paperNotes: { async appendPaperNote() { calls.push("append"); return "appended"; } },
    vault: { async add() { calls.push("vault"); return {} as never; } } as never,
    logs: { async add() { calls.push("log"); return {} as never; } } as never,
    papers: { async getById() { return { id: "paper-1", updatedAt: "rev-1" }; } },
    updatePaper: { async setStatus() { calls.push("paper-status"); return {} as never; }, async setRating() { calls.push("paper-rating"); return {} as never; }, async mergeTags() { calls.push("paper-tags"); return {} as never; } } as never,
    addPaper: { async addManual() { calls.push("paper"); return { id: "paper-1", metadata: {} } as never; } } as never,
    pushZotero: async () => { calls.push("zotero"); },
    lists: { async addPaperToList() { calls.push("list"); return {} as never; }, async addNoteToList() { calls.push("list-note"); return {} as never; } } as never,
    relations: { async add() { calls.push("relation"); return {} as never; } } as never,
    milestones: { async add() { calls.push("milestone"); return {} as never; } } as never,
    experiments: { async add() { calls.push("experiment"); return {} as never; } } as never,
  }));
  const inputs: [AiProposalKind, Record<string, unknown>][] = [
    ["append_paper_note", {}], ["create_vault_note", { title: "Note", body: "Body" }],
    ["create_log_entry", { body: "Body", kind: "daily" }], ["paper_update", { status: "read", rating: 4, tags: ["method"] }],
    ["reading_list_change", { listId: "list-1", paperId: "paper-1" }], ["relation", { fromPaper: "paper-1", toPaper: "paper-2", relation: "extends" }],
    ["zotero_import", { title: "Imported paper", authors: ["Ada"] }], ["milestone_follow_up", { title: "Follow up" }], ["experiment_follow_up", { name: "Run follow up" }],
  ];
  for (const [kind, payload] of inputs) assert.equal(await registry.execute(draft(kind, payload)), "accepted");
  assert.deepEqual(calls, ["append", "vault", "log", "paper-status", "paper-rating", "paper-tags", "list", "relation", "paper", "zotero", "milestone", "experiment"]);
});
