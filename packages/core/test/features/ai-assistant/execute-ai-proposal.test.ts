import assert from "node:assert/strict";
import test from "node:test";
import {
  AiProposalExecutorRegistry,
  ConflictError,
  ExecuteAiProposalUseCase,
  NotFoundError,
  appendPaperNote,
  type AiProposalExecution,
  type AiWriteProposal,
  type IAiPaperNoteAppender,
  type IAiProposalExecutor,
} from "../../../src/index.js";

/** One proposal row. `claimPending` checks and sets with no await between, as the database's one update does. */
function proposalStore(initial: AiWriteProposal) {
  let row = initial;
  return {
    get row() { return row; },
    async save(value: AiWriteProposal) { row = value; },
    async getById(id: string) { return row.id === id ? row : null; },
    async listPending() { return row.status === "pending" ? [row] : []; },
    async claimPending(id: string) {
      if (row.id !== id || row.status !== "pending") return false;
      row = { ...row, status: "executing" };
      return true;
    },
  };
}

type Store = ReturnType<typeof proposalStore>;

function useCaseOver(store: Pick<Store, "save" | "getById" | "listPending" | "claimPending">, executors: Pick<IAiProposalExecutor, "execute">, audits: string[] = []) {
  return new ExecuteAiProposalUseCase({
    proposals: store, audit: { async save(value) { audits.push(value.action); } },
    executors, ids: { newId: () => "audit-1" }, clock: { nowIso: () => "later" },
  });
}

const running = (run: () => Promise<AiProposalExecution>) => ({ execute: run });

const logProposal: AiWriteProposal = { id: "proposal-1", kind: "create_log_entry", resourceId: "00000000-0000-0000-0000-000000000001", content: "log", createdAt: "now", status: "pending", sourceLinks: [], payload: { body: "log" } };

test("executor lifecycle persists the outcome and immutable audit entry", async () => {
  const store = proposalStore(logProposal);
  const audits: string[] = [];
  assert.equal(await useCaseOver(store, running(async () => "accepted"), audits).execute("proposal-1"), "accepted");
  assert.equal(store.row.status, "accepted");
  assert.deepEqual(audits, ["accepted"]);
});

// --- run once (B17, 02-01) ---------------------------------------------------
//
// Two approvals of one proposal (a double click, two tabs) both read it as
// pending and both ran its executor, so a note was appended twice. The use case
// now claims the row first: only the caller that moves it from pending to
// executing runs the executor.

test("two approvals at once run the executor once", async () => {
  const store = proposalStore(logProposal);
  let runs = 0;
  const audits: string[] = [];
  const useCase = useCaseOver(store, running(async () => {
    runs += 1;
    await new Promise((r) => setTimeout(r, 5));
    return "accepted";
  }), audits);

  const outcomes = await Promise.allSettled([useCase.execute("proposal-1"), useCase.execute("proposal-1")]);

  assert.equal(runs, 1);
  assert.deepEqual(outcomes.map((o) => o.status).sort(), ["fulfilled", "rejected"]);
  const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof ConflictError);
  assert.equal(store.row.status, "accepted");
  assert.deepEqual(audits, ["accepted"]);
});

test("the executor runs while the proposal is marked executing", async () => {
  const store = proposalStore(logProposal);
  let seen: string | undefined;
  await useCaseOver(store, running(async () => { seen = store.row.status; return "accepted"; })).execute("proposal-1");
  assert.equal(seen, "executing");
});

test("an executor that throws leaves the proposal pending, and a retry runs it", async () => {
  const store = proposalStore(logProposal);
  const audits: string[] = [];
  await assert.rejects(useCaseOver(store, running(async () => { throw new Error("network down"); }), audits).execute("proposal-1"), /network down/);
  assert.equal(store.row.status, "pending");
  assert.deepEqual(audits, []);

  assert.equal(await useCaseOver(store, running(async () => "accepted"), audits).execute("proposal-1"), "accepted");
  assert.equal(store.row.status, "accepted");
  assert.deepEqual(audits, ["accepted"]);
});

test("a proposal already executing is a conflict and its executor is not run", async () => {
  const store = proposalStore({ ...logProposal, status: "executing" });
  let runs = 0;
  await assert.rejects(useCaseOver(store, running(async () => { runs += 1; return "accepted"; })).execute("proposal-1"), ConflictError);
  assert.equal(runs, 0);
  assert.equal(store.row.status, "executing");
});

test("a decided proposal is a conflict and a missing one is not found", async () => {
  let runs = 0;
  const run = running(async () => { runs += 1; return "accepted"; });
  await assert.rejects(useCaseOver(proposalStore({ ...logProposal, status: "accepted" }), run).execute("proposal-1"), ConflictError);
  await assert.rejects(useCaseOver(proposalStore(logProposal), run).execute("other"), NotFoundError);
  assert.equal(runs, 0);
});

test("a claim lost after the read is a conflict and runs nothing", async () => {
  // The read saw pending, but another caller claimed the row before this one.
  const store = proposalStore(logProposal);
  let runs = 0;
  const lost = { save: store.save, getById: store.getById, listPending: store.listPending, async claimPending() { return false; } };
  await assert.rejects(useCaseOver(lost, running(async () => { runs += 1; return "accepted"; })).execute("proposal-1"), ConflictError);
  assert.equal(runs, 0);
  assert.equal(store.row.status, "pending");
});

// --- ported from ConfirmAiProposalUseCase (02-03) ---------------------------
//
// Confirm was a second, unused path that ran append proposals; the review
// screen runs every kind through ExecuteAiProposal. Its cases now pin that path.

function appendExecutor(paperNotes: IAiPaperNoteAppender): IAiProposalExecutor {
  return {
    kind: "append_paper_note",
    async execute(proposal) {
      const result = await paperNotes.appendPaperNote({ paperId: proposal.resourceId, addition: proposal.content, expectedRevision: proposal.expectedRevision });
      return result === "appended" ? "accepted" : "conflicted";
    },
  };
}

const appendProposal: AiWriteProposal = {
  id: "proposal-1", kind: "append_paper_note", resourceId: "paper-1", content: "AI suggestion",
  createdAt: "2026-07-14T12:00:00.000Z", status: "pending", sourceLinks: [], expectedRevision: "rev-1",
};

test("an approved append lands when the revision still matches and records an audit", async () => {
  const store = proposalStore(appendProposal);
  let note = "Existing note";
  const audits: string[] = [];
  const registry = new AiProposalExecutorRegistry([appendExecutor({
    async appendPaperNote({ addition, expectedRevision }) {
      assert.equal(expectedRevision, "rev-1");
      note = appendPaperNote(note, addition);
      return "appended";
    },
  })]);
  assert.equal(await useCaseOver(store, registry, audits).execute("proposal-1"), "accepted");
  assert.equal(note, "Existing note\n\nAI suggestion");
  assert.equal(store.row.status, "accepted");
  assert.deepEqual(audits, ["accepted"]);
});

test("an append whose revision moved on is a conflict and keeps the note", async () => {
  const store = proposalStore({ ...appendProposal, expectedRevision: "old" });
  const audits: string[] = [];
  const registry = new AiProposalExecutorRegistry([appendExecutor({ async appendPaperNote() { return "conflicted"; } })]);
  assert.equal(await useCaseOver(store, registry, audits).execute("proposal-1"), "conflicted");
  assert.equal(store.row.status, "conflicted");
  assert.deepEqual(audits, ["conflicted"]);
});

test("a kind with no executor fails and leaves the proposal pending", async () => {
  const store = proposalStore(appendProposal);
  await assert.rejects(useCaseOver(store, new AiProposalExecutorRegistry([])).execute("proposal-1"), /No proposal executor/);
  assert.equal(store.row.status, "pending");
});
