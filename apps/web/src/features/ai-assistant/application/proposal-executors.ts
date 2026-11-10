import type {
  AddLogEntryUseCase, AddPaperUseCase, AddRelationUseCase, AiProposalExecution,
  AiWriteProposal, IAiPaperNoteAppender, IAiProposalExecutor, IReaderAnnotationSink, ManageExperimentUseCase,
  ManageMilestoneUseCase, ManagePaperFieldsUseCase, ManageReadingListUseCase, ManageReportSectionUseCase,
  ManageVaultPageUseCase, UpdatePaperUseCase,
} from "@weaveforge/core";
import { EXPERIMENT_STATUSES, proposalApplies } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

/**
 * Typed browser-only approval executors. The payload checks and the wiki-side
 * shaping live in the Rust core (wf-core `ai::proposal_inputs`, `ai::proposal_apply`);
 * this file keeps the host work: revision checks, the ink guard, and the calls into
 * the use cases. Invalid drafts fail closed before a write.
 */
export function createAiProposalExecutors(deps: {
  paperNotes: IAiPaperNoteAppender;
  vault: ManageVaultPageUseCase;
  logs: AddLogEntryUseCase;
  papers: { getById(id: string): Promise<{ id: string; updatedAt: string } | null> };
  updatePaper: UpdatePaperUseCase;
  paperFields: Pick<ManagePaperFieldsUseCase, "setValue" | "listDefs">;
  addPaper: AddPaperUseCase;
  pushZotero: (paper: Awaited<ReturnType<AddPaperUseCase["addManual"]>>) => Promise<void>;
  lists: ManageReadingListUseCase;
  relations: AddRelationUseCase;
  milestones: ManageMilestoneUseCase;
  experiments: ManageExperimentUseCase;
  vaultPages: { getById(id: string): Promise<{ id: string; body: string; updatedAt: string } | null> };
  reportSections: Pick<ManageReportSectionUseCase, "setNotes">;
  reportSectionById: (id: string) => Promise<{ id: string; updatedAt?: string } | null>;
  annotations: Pick<IReaderAnnotationSink, "create">;
}): readonly IAiProposalExecutor[] {
  // Ink notes are strokes behind a header line; a text edit would destroy them.
  const editableNote = async (proposal: AiWriteProposal) => {
    const page = await deps.vaultPages.getById(proposal.resourceId);
    if (!proposalApplies(page, proposal.expectedRevision)) return null;
    if (readyCore().isInkNoteBody(page.body)) throw new Error("Ink notes cannot be edited by a suggestion.");
    return page;
  };
  return [
    executor("append_paper_note", async (proposal) => {
      const addition = readyCore().proposalPaperNoteAddition(proposal.payload, proposal.content);
      return (await deps.paperNotes.appendPaperNote({ paperId: proposal.resourceId, addition, expectedRevision: proposal.expectedRevision })) === "appended" ? "accepted" : "conflicted";
    }),
    executor("create_vault_note", async (proposal) => {
      await deps.vault.add(readyCore().proposalVaultNote(proposal.payload) as Arg<ManageVaultPageUseCase["add"]>);
      return "accepted";
    }),
    executor("create_log_entry", async (proposal) => {
      await deps.logs.add(readyCore().proposalLogEntry(proposal.payload) as Arg<AddLogEntryUseCase["add"]>);
      return "accepted";
    }),
    executor("paper_update", async (proposal) => {
      const paper = await deps.papers.getById(proposal.resourceId);
      if (!proposalApplies(paper, proposal.expectedRevision)) return "conflicted";
      const update = readyCore().proposalPaperUpdate(proposal.payload);
      if (update.status) await deps.updatePaper.setStatus(paper.id, update.status as Arg<UpdatePaperUseCase["setStatus"], 1>);
      if (update.rating != null) await deps.updatePaper.setRating(paper.id, update.rating);
      if (update.tags) await deps.updatePaper.mergeTags(paper.id, update.tags, "manual");
      return "accepted";
    }),
    executor("paper_field_value", async (proposal) => {
      const paper = await deps.papers.getById(proposal.resourceId);
      if (!proposalApplies(paper, proposal.expectedRevision)) return "conflicted";
      // The field id is read before the fields are listed, so a bad payload fails before the lookup.
      readyCore().proposalPaperFieldId(proposal.payload);
      const defs = await deps.paperFields.listDefs();
      const fill = readyCore().proposalPaperFieldFill(proposal.payload, defs);
      await deps.paperFields.setValue(paper.id, fill.fieldId, fill.value);
      return "accepted";
    }),
    executor("reading_list_change", async (proposal) => {
      const change = readyCore().proposalReadingListChange(proposal.payload);
      const note = change.note ?? undefined;
      if (change.target.kind === "paper") await deps.lists.addPaperToList(change.listId, change.target.id, note);
      else await deps.lists.addNoteToList(change.listId, change.target.id, note);
      return "accepted";
    }),
    executor("relation", async (proposal) => {
      await deps.relations.add({ ...readyCore().proposalRelation(proposal.payload), source: "manual" } as Arg<AddRelationUseCase["add"]>);
      return "accepted";
    }),
    executor("zotero_import", async (proposal) => {
      await deps.pushZotero(await deps.addPaper.addManual(readyCore().proposalZoteroImport(proposal.payload) as Arg<AddPaperUseCase["addManual"]>));
      return "accepted";
    }),
    executor("milestone_follow_up", async (proposal) => {
      await deps.milestones.add(readyCore().proposalMilestoneFollowUp(proposal.payload) as Arg<ManageMilestoneUseCase["add"]>);
      return "accepted";
    }),
    executor("experiment_follow_up", async (proposal) => {
      await deps.experiments.add(readyCore().proposalExperimentFollowUp(proposal.payload) as Arg<ManageExperimentUseCase["add"]>);
      return "accepted";
    }),
    executor("edit_vault_note", async (proposal) => {
      const page = await editableNote(proposal);
      if (!page) return "conflicted";
      await deps.vault.update(page.id, readyCore().proposalEditVaultNote(proposal.payload) as Arg<ManageVaultPageUseCase["update"], 1>);
      return "accepted";
    }),
    executor("append_vault_note", async (proposal) => {
      const page = await editableNote(proposal);
      if (!page) return "conflicted";
      await deps.vault.update(page.id, { body: readyCore().proposalAppendVaultNoteBody(page.body, proposal.payload) });
      return "accepted";
    }),
    executor("report_edit", async (proposal) => {
      const section = await deps.reportSectionById(proposal.resourceId);
      if (!section) return "conflicted";
      if (proposal.expectedRevision && section.updatedAt !== proposal.expectedRevision) return "conflicted";
      await deps.reportSections.setNotes(section.id, readyCore().proposalReportNotes(proposal.payload));
      return "accepted";
    }),
    executor("milestone_status", async (proposal) => {
      const status = readyCore().proposalMilestoneStatus(proposal.payload) as Parameters<ManageMilestoneUseCase["setStatus"]>[1];
      await deps.milestones.setStatus(proposal.resourceId, status);
      return "accepted";
    }),
    executor("experiment_update", async (proposal) => {
      const update = readyCore().proposalExperimentUpdate<{
        status?: (typeof EXPERIMENT_STATUSES)[number];
        metrics?: Record<string, unknown>;
        artifacts?: string[];
      }>(proposal.payload);
      if (update.status) await deps.experiments.setStatus(proposal.resourceId, update.status);
      if (update.metrics) await deps.experiments.recordMetrics(proposal.resourceId, update.metrics);
      if (update.artifacts) await deps.experiments.addArtifacts(proposal.resourceId, update.artifacts);
      return "accepted";
    }),
    executor("paper_annotation", async (proposal) => {
      const paper = await deps.papers.getById(proposal.resourceId);
      if (!paper) return "conflicted";
      // Quote-anchored: the reader finds the words on the page, no rects needed.
      await deps.annotations.create(paper.id, readyCore().proposalPaperAnnotation(proposal.payload) as Arg<IReaderAnnotationSink["create"], 1>);
      return "accepted";
    }),
  ];
}

/**
 * The use case's argument type. The Rust core checks every value it returns (statuses, relation
 * names, annotation types) and omits absent fields, so its looser generated types narrow safely.
 */
type Arg<F extends (...args: never[]) => unknown, I extends number = 0> = Parameters<F>[I];

function executor(kind: IAiProposalExecutor["kind"], execute: (proposal: AiWriteProposal) => Promise<AiProposalExecution>): IAiProposalExecutor { return { kind, execute }; }
