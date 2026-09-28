import type {
  AddLogEntryUseCase, AddPaperUseCase, AddRelationUseCase, AiProposalExecution,
  AiWriteProposal, IAiPaperNoteAppender, IAiProposalExecutor, IReaderAnnotationSink, ManageExperimentUseCase,
  ManageMilestoneUseCase, ManagePaperFieldsUseCase, ManageReadingListUseCase, ManageReportSectionUseCase,
  ManageVaultPageUseCase, NewExperimentInput, NewLogEntryInput, NewMilestoneInput, NewPaperInput,
  PaperFieldValueData, PaperStatus, UpdatePaperUseCase,
} from "@weaveforge/core";
import { EXPERIMENT_STATUSES, isInkNoteBody, proposalApplies } from "@weaveforge/core";

/** Typed browser-only approval executors. Invalid drafts fail closed before a write. */
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
    if (isInkNoteBody(page.body)) throw new Error("Ink notes cannot be edited by a suggestion.");
    return page;
  };
  return [
    executor("append_paper_note", async (proposal) => { const payload = proposal.payload; const addition = payload && typeof payload.addition === "string" ? payload.addition : proposal.content; return (await deps.paperNotes.appendPaperNote({ paperId: proposal.resourceId, addition, expectedRevision: proposal.expectedRevision })) === "appended" ? "accepted" : "conflicted"; }),
    executor("create_vault_note", async (proposal) => { const p = object(proposal); await deps.vault.add({ title: text(p, "title"), body: text(p, "body"), parentId: optionalText(p, "parentId") }); return "accepted"; }),
    executor("create_log_entry", async (proposal) => { const p = object(proposal); await deps.logs.add({ body: text(p, "body"), entryDate: optionalText(p, "entryDate"), kind: enumValue(p, "kind", ["daily", "weekly"] as const) } satisfies NewLogEntryInput); return "accepted"; }),
    executor("paper_update", async (proposal) => {
      const paper = await deps.papers.getById(proposal.resourceId);
      if (!proposalApplies(paper, proposal.expectedRevision)) return "conflicted";
      const p = object(proposal); const status = enumValue(p, "status", ["to_read", "reading", "read", "skimmed"] as const);
      const rating = optionalNumber(p, "rating"); const tags = stringArray(p, "tags");
      if (status) await deps.updatePaper.setStatus(paper.id, status as PaperStatus);
      if (rating !== undefined) await deps.updatePaper.setRating(paper.id, rating);
      if (tags) await deps.updatePaper.mergeTags(paper.id, tags, "manual");
      if (!status && rating === undefined && !tags) throw new Error("Paper update proposal contains no allowed changes.");
      return "accepted";
    }),
    executor("paper_field_value", async (proposal) => {
      const paper = await deps.papers.getById(proposal.resourceId);
      if (!proposalApplies(paper, proposal.expectedRevision)) return "conflicted";
      const p = object(proposal);
      const fieldId = text(p, "fieldId");
      const defs = await deps.paperFields.listDefs();
      const def = defs.find((d) => d.id === fieldId);
      if (!def) throw new Error(`No field with id "${fieldId}".`);
      if (def.kind !== "text" && def.kind !== "number" && def.kind !== "select" && def.kind !== "multi_select") {
        throw new Error("Only text, number, select, and multi_select fields can be filled via AI.");
      }
      const value = fieldValueData(p, "value");
      if (def.kind === "select") {
        if (typeof value !== "string" || !def.options.includes(value)) {
          throw new Error(`Value is not one of the allowed options for «${def.name}».`);
        }
      }
      if (def.kind === "multi_select") {
        if (!Array.isArray(value) || value.some((item) => !def.options.includes(item))) {
          throw new Error(`Value contains options not allowed for «${def.name}».`);
        }
      }
      await deps.paperFields.setValue(paper.id, fieldId, value);
      return "accepted";
    }),
    executor("reading_list_change", async (proposal) => { const p = object(proposal); const listId = text(p, "listId"); const note = optionalText(p, "note"); const paperId = optionalText(p, "paperId"); const vaultPageId = optionalText(p, "vaultPageId"); if (paperId === vaultPageId) throw new Error("Reading-list proposal must target exactly one paper or vault note."); if (paperId) await deps.lists.addPaperToList(listId, paperId, note); else if (vaultPageId) await deps.lists.addNoteToList(listId, vaultPageId, note); else throw new Error("Reading-list proposal needs a target."); return "accepted"; }),
    executor("relation", async (proposal) => { const p = object(proposal); const relation = enumValue(p, "relation", ["cites", "extends", "contradicts", "similar", "builds_on", "uses_method"] as const); if (!relation) throw new Error("Proposal relation is required."); await deps.relations.add({ fromPaper: text(p, "fromPaper"), toPaper: text(p, "toPaper"), relation, source: "manual" }); return "accepted"; }),
    executor("zotero_import", async (proposal) => { const p = object(proposal); const paper = await deps.addPaper.addManual(p as unknown as NewPaperInput); await deps.pushZotero(paper); return "accepted"; }),
    executor("milestone_follow_up", async (proposal) => { await deps.milestones.add(object(proposal) as unknown as NewMilestoneInput); return "accepted"; }),
    executor("experiment_follow_up", async (proposal) => { await deps.experiments.add(object(proposal) as unknown as NewExperimentInput); return "accepted"; }),
    executor("edit_vault_note", async (proposal) => {
      const page = await editableNote(proposal);
      if (!page) return "conflicted";
      const p = object(proposal); const title = optionalText(p, "title"); const body = typeof p.body === "string" ? p.body : undefined;
      if (title === undefined && body === undefined) throw new Error("Note edit proposal contains no changes.");
      await deps.vault.update(page.id, { title, body });
      return "accepted";
    }),
    executor("append_vault_note", async (proposal) => {
      const page = await editableNote(proposal);
      if (!page) return "conflicted";
      const addition = text(object(proposal), "addition");
      await deps.vault.update(page.id, { body: page.body.trimEnd() ? `${page.body.trimEnd()}

${addition}` : addition });
      return "accepted";
    }),
    executor("report_edit", async (proposal) => {
      const section = await deps.reportSectionById(proposal.resourceId);
      if (!section) return "conflicted";
      if (proposal.expectedRevision && section.updatedAt !== proposal.expectedRevision) return "conflicted";
      const p = object(proposal);
      if (typeof p.notes !== "string") throw new Error("Proposal notes is required.");
      await deps.reportSections.setNotes(section.id, p.notes);
      return "accepted";
    }),
    executor("milestone_status", async (proposal) => {
      const status = enumValue(object(proposal), "status", ["planned", "in_progress", "done", "blocked"] as const);
      if (!status) throw new Error("Proposal status is required.");
      await deps.milestones.setStatus(proposal.resourceId, status);
      return "accepted";
    }),
    executor("experiment_update", async (proposal) => {
      const p = object(proposal);
      const status = enumValue(p, "status", EXPERIMENT_STATUSES);
      const metrics = p.metrics === undefined ? undefined : record(p, "metrics");
      const artifacts = stringArray(p, "artifacts");
      if (!status && !metrics && !artifacts) throw new Error("Experiment update proposal contains no allowed changes.");
      if (status) await deps.experiments.setStatus(proposal.resourceId, status);
      if (metrics) await deps.experiments.recordMetrics(proposal.resourceId, metrics);
      if (artifacts) await deps.experiments.addArtifacts(proposal.resourceId, artifacts);
      return "accepted";
    }),
    executor("paper_annotation", async (proposal) => {
      const paper = await deps.papers.getById(proposal.resourceId);
      if (!paper) return "conflicted";
      const p = object(proposal);
      const pageIndex = optionalNumber(p, "pageIndex") ?? 0;
      if (!Number.isInteger(pageIndex) || pageIndex < 0) throw new Error("Proposal pageIndex is invalid.");
      // Quote-anchored: the reader finds the words on the page, no rects needed.
      await deps.annotations.create(paper.id, {
        type: enumValue(p, "type", ["highlight", "note"] as const) ?? "highlight",
        color: optionalText(p, "color") ?? "#ffd400",
        text: text(p, "quote"),
        comment: optionalText(p, "comment"),
        anchor: { locus: { quote: { type: "TextQuoteSelector", exact: text(p, "quote") } } },
        pageIndex,
      });
      return "accepted";
    }),
  ];
}

function executor(kind: IAiProposalExecutor["kind"], execute: (proposal: AiWriteProposal) => Promise<AiProposalExecution>): IAiProposalExecutor { return { kind, execute }; }
function object(proposal: AiWriteProposal): Record<string, unknown> { if (!proposal.payload || typeof proposal.payload !== "object" || Array.isArray(proposal.payload)) throw new Error("Proposal payload is missing or invalid."); return proposal.payload; }
function text(value: Record<string, unknown>, key: string): string { const v = value[key]; if (typeof v !== "string" || !v.trim()) throw new Error(`Proposal ${key} is required.`); return v.trim(); }
function optionalText(value: Record<string, unknown>, key: string): string | undefined { const v = value[key]; return typeof v === "string" && v.trim() ? v.trim() : undefined; }
function optionalNumber(value: Record<string, unknown>, key: string): number | undefined { const v = value[key]; if (v === undefined) return undefined; if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Proposal ${key} must be a number.`); return v; }
function record(value: Record<string, unknown>, key: string): Record<string, unknown> { const v = value[key]; if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`Proposal ${key} must be an object.`); return v as Record<string, unknown>; }
function stringArray(value: Record<string, unknown>, key: string): string[] | undefined { const v = value[key]; if (v === undefined) return undefined; if (!Array.isArray(v) || v.some((item) => typeof item !== "string")) throw new Error(`Proposal ${key} must be a string list.`); return v; }
function enumValue<T extends string>(value: Record<string, unknown>, key: string, allowed: readonly T[]): T | undefined { const v = value[key]; if (v === undefined) return undefined; if (typeof v !== "string" || !allowed.includes(v as T)) throw new Error(`Proposal ${key} is invalid.`); return v as T; }
function fieldValueData(value: Record<string, unknown>, key: string): PaperFieldValueData {
  const v = value[key];
  if (typeof v === "string") {
    if (!v.trim()) throw new Error(`Proposal ${key} must be a non-empty string, number, or string list.`);
    return v;
  }
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (Array.isArray(v) && v.length > 0 && v.every((item) => typeof item === "string")) {
    const cleaned = (v as string[]).map((item) => item.trim()).filter(Boolean);
    if (!cleaned.length) throw new Error(`Proposal ${key} must be a string, number, or non-empty string list.`);
    return cleaned;
  }
  throw new Error(`Proposal ${key} must be a string, number, or non-empty string list.`);
}
