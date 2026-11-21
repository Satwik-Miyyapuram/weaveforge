import assert from "node:assert/strict";
import test from "node:test";
import { AiProposalExecutorRegistry, type AiProposalKind, type AiWriteProposal } from "@weaveforge/core";
import { AiProposalFacade } from "@/container/facades/ai-proposals";
import { createAiProposalExecutors } from "../application/parts";

// Every edit draft remembers the row it was drafted against, so approving it
// after the user changed that row conflicts instead of overwriting the change.
// Milestones and runs carry no updatedAt, so their whole row is the revision.

type Row = { id: string; updatedAt?: string; [key: string]: unknown };

function world() {
  const rows: Record<string, Row> = {
    note: { id: "note", title: "N", body: "Body", updatedAt: "note-rev" },
    section: { id: "section", title: "S", notes: "Old", updatedAt: "section-rev" },
    milestone: { id: "milestone", title: "M", status: "planned" },
    run: { id: "run", name: "R", status: "running" },
    paper: { id: "paper", title: "P", updatedAt: "paper-rev" },
  };
  const repo = (id: string) => ({ async getById(asked: string) { return asked === id ? { ...rows[id] } : null; } });
  const sources = { papers: repo("paper"), vaultPages: repo("note"), reportSections: repo("section"), milestones: repo("milestone"), experiments: repo("run") };
  return { rows, sources };
}

function proposals() {
  const saved: AiWriteProposal[] = [];
  const facadeDeps = {
    proposals: { async save(p: AiWriteProposal) { saved.push(p); }, async getById() { return null; }, async listPending() { return []; } } as never,
    audit: { async save() {} } as never,
    executors: new AiProposalExecutorRegistry([]),
    newId: () => `id-${saved.length}`,
    now: () => "2026-01-02T00:00:00.000Z",
  };
  return { saved, facadeDeps };
}

const EDITS: { kind: AiProposalKind; resourceId: string; payload: Record<string, unknown>; revision?: string }[] = [
  { kind: "edit_vault_note", resourceId: "note", payload: { body: "New" }, revision: "note-rev" },
  { kind: "append_vault_note", resourceId: "note", payload: { addition: "More" }, revision: "note-rev" },
  { kind: "report_edit", resourceId: "section", payload: { notes: "New" }, revision: "section-rev" },
  { kind: "milestone_status", resourceId: "milestone", payload: { status: "done" } },
  { kind: "experiment_update", resourceId: "run", payload: { status: "done" } },
];

for (const edit of EDITS) {
  test(`a folder ${edit.kind} draft without a revision is saved with the row's current one`, async () => {
    const { sources } = world();
    const { saved, facadeDeps } = proposals();
    const facade = new AiProposalFacade({ ...facadeDeps, revisionSources: sources } as never);
    await facade.draftLocal({ kind: edit.kind, resourceId: edit.resourceId, content: "change", payload: edit.payload });
    assert.equal(saved.length, 1);
    const stamped = saved[0]?.expectedRevision;
    if (edit.revision) assert.equal(stamped, edit.revision);
    else assert.ok(stamped, "a row without updatedAt still gets a revision");
  });
}

test("a create draft gets no revision", async () => {
  const { sources } = world();
  const { saved, facadeDeps } = proposals();
  const facade = new AiProposalFacade({ ...facadeDeps, revisionSources: sources } as never);
  await facade.draftLocal({ kind: "create_vault_note", resourceId: "new", content: "c", payload: { title: "T", body: "" } });
  assert.equal(saved[0]?.expectedRevision, undefined);
});

function executorsOver(rows: Record<string, Row>) {
  const writes: string[] = [];
  const byId = (id: string) => async (asked: string) => (asked === id ? { ...rows[id] } as never : null);
  const registry = new AiProposalExecutorRegistry(createAiProposalExecutors({
    paperNotes: {} as never, vault: {} as never, logs: {} as never, papers: {} as never,
    updatePaper: {} as never, paperFields: {} as never, addPaper: {} as never, pushZotero: async () => undefined,
    lists: {} as never, relations: {} as never,
    milestones: { async setStatus() { writes.push("milestone"); return {} as never; } } as never,
    experiments: { async setStatus() { writes.push("run"); return {} as never; } } as never,
    milestoneById: byId("milestone"), experimentById: byId("run"),
    vaultPages: {} as never,
    reportSections: { async setNotes() { writes.push("section"); return {} as never; } },
    reportSectionById: byId("section"),
    annotations: {} as never,
  }));
  return { registry, writes };
}

for (const edit of EDITS.filter((e) => ["milestone_status", "experiment_update", "report_edit"].includes(e.kind))) {
  test(`a stamped ${edit.kind} applies to the unchanged row and conflicts once the row changed`, async () => {
    const { rows, sources } = world();
    const { saved, facadeDeps } = proposals();
    const facade = new AiProposalFacade({ ...facadeDeps, revisionSources: sources } as never);
    await facade.draftLocal({ kind: edit.kind, resourceId: edit.resourceId, content: "change", payload: edit.payload });
    const proposal = saved[0]!;

    const unchanged = executorsOver(rows);
    assert.equal(await unchanged.registry.execute(proposal), "accepted");

    const row = rows[edit.resourceId]!;
    rows[edit.resourceId] = row.updatedAt ? { ...row, title: "edited", updatedAt: "later" } : { ...row, title: "edited" };
    const changed = executorsOver(rows);
    assert.equal(await changed.registry.execute(proposal), "conflicted");
    assert.deepEqual(changed.writes, []);
  });
}
