import assert from "node:assert/strict";
import test from "node:test";
import {
  AiProposalExecutorRegistry,
  type AiProposalKind,
  type AiWriteProposal,
  type PaperFieldDef,
} from "@weaveforge/core";
import { createAiProposalExecutors } from "../application/proposal-executors";

const draft = (kind: AiProposalKind, payload: Record<string, unknown>): AiWriteProposal => ({ id: `proposal-${kind}`, kind, resourceId: "paper-1", content: "Append this", createdAt: "2026-07-15T00:00:00.000Z", status: "pending", sourceLinks: [], payload });

/**
 * The dependency bag for the `paper_field_value` cases.
 *
 * Four tests needed the same fifteen doubles and varied two things between
 * them: the field definitions on offer, and whether the stored paper's revision
 * matches. Writing the bag out each time buried that difference — which is the
 * one thing a reader of the test needs to see.
 */
function fieldValueExecutors(
  defs: PaperFieldDef[],
  { revision = "rev-1", writable = false }: { revision?: string; writable?: boolean } = {},
) {
  return new AiProposalExecutorRegistry(
    createAiProposalExecutors({
      paperNotes: { async appendPaperNote() { return "appended"; } },
      vault: { async add() { return {} as never; } } as never,
      logs: { async add() { return {} as never; } } as never,
      papers: { async getById() { return { id: "paper-1", updatedAt: revision }; } },
      updatePaper: {} as never,
      paperFields: {
        async listDefs() { return defs; },
        async setValue() {
          if (!writable) throw new Error("should not write");
          return {} as never;
        },
      },
      addPaper: {} as never,
      pushZotero: async () => undefined,
      lists: {} as never,
      relations: {} as never,
      milestones: {} as never,
      experiments: {} as never,
      vaultPages: {} as never,
      reportSections: {} as never,
      reportSectionById: async () => null,
      annotations: {} as never,
    }),
  );
}

test("every proposal kind is handled by the browser-only executor registry", async () => {
  const calls: string[] = [];
  const registry = new AiProposalExecutorRegistry(createAiProposalExecutors({
    paperNotes: { async appendPaperNote() { calls.push("append"); return "appended"; } },
    vault: { async add() { calls.push("vault"); return {} as never; }, async update(_id: string, patch: { body?: string }) { calls.push(`note-update:${patch.body}`); return {} as never; } } as never,
    logs: { async add() { calls.push("log"); return {} as never; } } as never,
    papers: { async getById() { return { id: "paper-1", updatedAt: "rev-1" }; } },
    updatePaper: { async setStatus() { calls.push("paper-status"); return {} as never; }, async setRating() { calls.push("paper-rating"); return {} as never; }, async mergeTags() { calls.push("paper-tags"); return {} as never; } } as never,
    paperFields: {
      async listDefs() { return [{ id: "f1", name: "Method", kind: "text" as const, options: [], sortOrder: 0 }]; },
      async setValue(_paperId, fieldId, value) { calls.push(`field:${fieldId}:${String(value)}`); return {} as never; },
    },
    addPaper: { async addManual() { calls.push("paper"); return { id: "paper-1", metadata: {} } as never; } } as never,
    pushZotero: async () => { calls.push("zotero"); },
    lists: { async addPaperToList() { calls.push("list"); return {} as never; }, async addNoteToList() { calls.push("list-note"); return {} as never; } } as never,
    relations: { async add() { calls.push("relation"); return {} as never; } } as never,
    milestones: { async add() { calls.push("milestone"); return {} as never; }, async setStatus() { calls.push("milestone-status"); return {} as never; } } as never,
    experiments: {
      async add() { calls.push("experiment"); return {} as never; },
      async setStatus() { calls.push("exp-status"); return {} as never; },
      async recordMetrics() { calls.push("exp-metrics"); return {} as never; },
      async addArtifacts() { calls.push("exp-artifacts"); return {} as never; },
    } as never,
    vaultPages: { async getById() { return { id: "paper-1", body: "Old", updatedAt: "rev-1" }; } },
    reportSections: { async setNotes() { calls.push("report"); return {} as never; } },
    reportSectionById: async () => ({ id: "paper-1", updatedAt: "rev-1" }),
    annotations: { async create() { calls.push("annotation"); return {} as never; } },
  }));
  const inputs: [AiProposalKind, Record<string, unknown>][] = [
    ["append_paper_note", {}], ["create_vault_note", { title: "Note", body: "Body" }],
    ["create_log_entry", { body: "Body", kind: "daily" }], ["paper_update", { status: "read", rating: 4, tags: ["method"] }],
    ["paper_field_value", { fieldId: "f1", value: "VAE" }],
    ["reading_list_change", { listId: "list-1", paperId: "paper-1" }], ["relation", { fromPaper: "paper-1", toPaper: "paper-2", relation: "extends" }],
    ["zotero_import", { title: "Imported paper", authors: ["Ada"] }], ["milestone_follow_up", { title: "Follow up" }], ["experiment_follow_up", { name: "Run follow up" }],
    ["edit_vault_note", { body: "New" }], ["append_vault_note", { addition: "More" }], ["report_edit", { notes: "Draft" }],
    ["milestone_status", { status: "done" }], ["experiment_update", { status: "done", metrics: { acc: 0.9 }, artifacts: ["model.pt"] }],
    ["paper_annotation", { quote: "a key sentence" }],
  ];
  for (const [kind, payload] of inputs) assert.equal(await registry.execute(draft(kind, payload)), "accepted");
  assert.deepEqual(calls, ["append", "vault", "log", "paper-status", "paper-rating", "paper-tags", "field:f1:VAE", "list", "relation", "paper", "zotero", "milestone", "experiment",
    "note-update:New", "note-update:Old\n\nMore", "report", "milestone-status", "exp-status", "exp-metrics", "exp-artifacts", "annotation"]);
});

test("paper_field_value conflicts when expectedRevision mismatches", async () => {
  const registry = fieldValueExecutors(
    [{ id: "f1", name: "Method", kind: "text" as const, options: [], sortOrder: 0 }],
    { revision: "rev-new" },
  );
  const proposal = draft("paper_field_value", { fieldId: "f1", value: "x" });
  proposal.expectedRevision = "rev-old";
  assert.equal(await registry.execute(proposal), "conflicted");
});

test("paper_field_value rejects non-fillable field kinds", async () => {
  const registry = fieldValueExecutors([
    { id: "rel", name: "Related", kind: "relation" as const, options: [], sortOrder: 0 },
  ]);
  await assert.rejects(
    () => registry.execute(draft("paper_field_value", { fieldId: "rel", value: ["p2"] })),
    /Only text, number, select, and multi_select/i,
  );
});

test("paper_field_value rejects select values outside options", async () => {
  const registry = fieldValueExecutors([
    { id: "s1", name: "Tier", kind: "select" as const, options: ["A", "B"], sortOrder: 0 },
  ]);
  await assert.rejects(
    () => registry.execute(draft("paper_field_value", { fieldId: "s1", value: "Z" })),
    /not one of the allowed options/i,
  );
});

test("paper_field_value rejects empty value payload", async () => {
  const registry = fieldValueExecutors(
    [{ id: "f1", name: "Method", kind: "text" as const, options: [], sortOrder: 0 }],
    { writable: true },
  );
  await assert.rejects(
    () => registry.execute(draft("paper_field_value", { fieldId: "f1", value: [] })),
    /string, number, or non-empty string list/i,
  );
  await assert.rejects(
    () => registry.execute(draft("paper_field_value", { fieldId: "f1", value: "   " })),
    /non-empty string/i,
  );
  await assert.rejects(
    () => registry.execute(draft("paper_field_value", { fieldId: "f1", value: ["  ", ""] })),
    /non-empty string list/i,
  );
});

/** A bag for the suggestion kinds: doubles that record what they were asked to write. */
function suggestionExecutors(opts: { noteBody?: string; noteRev?: string; sectionRev?: string; paper?: boolean } = {}) {
  const writes: unknown[] = [];
  const registry = new AiProposalExecutorRegistry(createAiProposalExecutors({
    paperNotes: {} as never, vault: { async update(id: string, patch: unknown) { writes.push({ id, patch }); return {} as never; } } as never,
    logs: {} as never, papers: { async getById() { return opts.paper === false ? null : { id: "paper-1", updatedAt: "rev-1" }; } },
    updatePaper: {} as never, paperFields: {} as never, addPaper: {} as never, pushZotero: async () => undefined,
    lists: {} as never, relations: {} as never, milestones: {} as never, experiments: {} as never,
    vaultPages: { async getById() { return { id: "paper-1", body: opts.noteBody ?? "Body", updatedAt: opts.noteRev ?? "rev-1" }; } },
    reportSections: { async setNotes(id: string, notes: string) { writes.push({ id, notes }); return {} as never; } },
    reportSectionById: async () => ({ id: "paper-1", updatedAt: opts.sectionRev ?? "rev-1" }),
    annotations: { async create(paperId, annotation) { writes.push({ paperId, annotation }); return {} as never; } },
  }));
  return { registry, writes };
}

test("note edits conflict when the note changed since the suggestion", async () => {
  const { registry, writes } = suggestionExecutors({ noteRev: "rev-2" });
  assert.equal(await registry.execute({ ...draft("edit_vault_note", { body: "New" }), expectedRevision: "rev-1" }), "conflicted");
  assert.deepEqual(writes, []);
});

test("note edits refuse ink notes rather than overwrite the strokes", async () => {
  const { registry, writes } = suggestionExecutors({ noteBody: "<!-- weaveforge-ink -->\n" });
  await assert.rejects(registry.execute(draft("append_vault_note", { addition: "More" })), /Ink notes/);
  assert.deepEqual(writes, []);
});

test("report_edit conflicts on a stale section revision", async () => {
  const { registry, writes } = suggestionExecutors({ sectionRev: "rev-2" });
  assert.equal(await registry.execute({ ...draft("report_edit", { notes: "x" }), expectedRevision: "rev-1" }), "conflicted");
  assert.deepEqual(writes, []);
});

test("paper_annotation writes a quote-anchored highlight and conflicts on a missing paper", async () => {
  const { registry, writes } = suggestionExecutors();
  assert.equal(await registry.execute(draft("paper_annotation", { quote: "the words", comment: "why", pageIndex: 2 })), "accepted");
  assert.deepEqual(writes, [{ paperId: "paper-1", annotation: {
    type: "highlight", color: "#ffd400", text: "the words", comment: "why",
    anchor: { locus: { quote: { type: "TextQuoteSelector", exact: "the words" } } }, pageIndex: 2,
  } }]);
  const missing = suggestionExecutors({ paper: false });
  assert.equal(await missing.registry.execute(draft("paper_annotation", { quote: "x" })), "conflicted");
});

test("milestone_status and experiment_update reject empty or unknown values", async () => {
  const { registry } = suggestionExecutors();
  await assert.rejects(registry.execute(draft("milestone_status", { status: "someday" })));
  await assert.rejects(registry.execute(draft("experiment_update", {})));
});
