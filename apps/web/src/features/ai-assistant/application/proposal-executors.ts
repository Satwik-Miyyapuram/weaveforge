import type {
  AddLogEntryUseCase, AddPaperUseCase, AddRelationUseCase, AiProposalExecution,
  AiWriteProposal, IAiPaperNoteAppender, IAiProposalExecutor, ManageExperimentUseCase,
  ManageMilestoneUseCase, ManageReadingListUseCase, ManageVaultPageUseCase,
  NewExperimentInput, NewLogEntryInput, NewMilestoneInput, NewPaperInput,
  PaperStatus, UpdatePaperUseCase,
} from "@thesis/core";
import { appendPaperNote } from "@thesis/core";

/** Typed browser-only approval executors. Invalid drafts fail closed before a write. */
export function createAiProposalExecutors(deps: {
  paperNotes: IAiPaperNoteAppender;
  vault: ManageVaultPageUseCase;
  logs: AddLogEntryUseCase;
  papers: { getById(id: string): Promise<{ id: string; updatedAt: string } | null> };
  updatePaper: UpdatePaperUseCase;
  addPaper: AddPaperUseCase;
  pushZotero: (paper: Awaited<ReturnType<AddPaperUseCase["addManual"]>>) => Promise<void>;
  lists: ManageReadingListUseCase;
  relations: AddRelationUseCase;
  milestones: ManageMilestoneUseCase;
  experiments: ManageExperimentUseCase;
}): readonly IAiProposalExecutor[] {
  return [
    executor("append_paper_note", async (proposal) => { const payload = proposal.payload; const addition = payload && typeof payload.addition === "string" ? payload.addition : proposal.content; return (await deps.paperNotes.appendPaperNote({ paperId: proposal.resourceId, addition, expectedRevision: proposal.expectedRevision })) === "appended" ? "accepted" : "conflicted"; }),
    executor("create_vault_note", async (proposal) => { const p = object(proposal); await deps.vault.add({ title: text(p, "title"), body: text(p, "body"), parentId: optionalText(p, "parentId") }); return "accepted"; }),
    executor("create_log_entry", async (proposal) => { const p = object(proposal); await deps.logs.add({ body: text(p, "body"), entryDate: optionalText(p, "entryDate"), kind: enumValue(p, "kind", ["daily", "weekly"] as const) } satisfies NewLogEntryInput); return "accepted"; }),
    executor("paper_update", async (proposal) => {
      const paper = await deps.papers.getById(proposal.resourceId);
      if (!paper || (proposal.expectedRevision && paper.updatedAt !== proposal.expectedRevision)) return "conflicted";
      const p = object(proposal); const status = enumValue(p, "status", ["to_read", "reading", "read", "skimmed"] as const);
      const rating = optionalNumber(p, "rating"); const tags = stringArray(p, "tags");
      if (status) await deps.updatePaper.setStatus(paper.id, status as PaperStatus);
      if (rating !== undefined) await deps.updatePaper.setRating(paper.id, rating);
      if (tags) await deps.updatePaper.mergeTags(paper.id, tags, "manual");
      if (!status && rating === undefined && !tags) throw new Error("Paper update proposal contains no allowed changes.");
      return "accepted";
    }),
    executor("reading_list_change", async (proposal) => { const p = object(proposal); const listId = text(p, "listId"); const note = optionalText(p, "note"); const paperId = optionalText(p, "paperId"); const vaultPageId = optionalText(p, "vaultPageId"); if (paperId === vaultPageId) throw new Error("Reading-list proposal must target exactly one paper or vault note."); if (paperId) await deps.lists.addPaperToList(listId, paperId, note); else if (vaultPageId) await deps.lists.addNoteToList(listId, vaultPageId, note); else throw new Error("Reading-list proposal needs a target."); return "accepted"; }),
    executor("relation", async (proposal) => { const p = object(proposal); const relation = enumValue(p, "relation", ["cites", "extends", "contradicts", "similar", "builds_on", "uses_method"] as const); if (!relation) throw new Error("Proposal relation is required."); await deps.relations.add({ fromPaper: text(p, "fromPaper"), toPaper: text(p, "toPaper"), relation, source: "manual" }); return "accepted"; }),
    executor("zotero_import", async (proposal) => { const p = object(proposal); const paper = await deps.addPaper.addManual(p as unknown as NewPaperInput); await deps.pushZotero(paper); return "accepted"; }),
    executor("milestone_follow_up", async (proposal) => { await deps.milestones.add(object(proposal) as unknown as NewMilestoneInput); return "accepted"; }),
    executor("experiment_follow_up", async (proposal) => { await deps.experiments.add(object(proposal) as unknown as NewExperimentInput); return "accepted"; }),
  ];
}

function executor(kind: IAiProposalExecutor["kind"], execute: (proposal: AiWriteProposal) => Promise<AiProposalExecution>): IAiProposalExecutor { return { kind, execute }; }
function object(proposal: AiWriteProposal): Record<string, unknown> { if (!proposal.payload || typeof proposal.payload !== "object" || Array.isArray(proposal.payload)) throw new Error("Proposal payload is missing or invalid."); return proposal.payload; }
function text(value: Record<string, unknown>, key: string): string { const v = value[key]; if (typeof v !== "string" || !v.trim()) throw new Error(`Proposal ${key} is required.`); return v.trim(); }
function optionalText(value: Record<string, unknown>, key: string): string | undefined { const v = value[key]; return typeof v === "string" && v.trim() ? v.trim() : undefined; }
function optionalNumber(value: Record<string, unknown>, key: string): number | undefined { const v = value[key]; if (v === undefined) return undefined; if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Proposal ${key} must be a number.`); return v; }
function stringArray(value: Record<string, unknown>, key: string): string[] | undefined { const v = value[key]; if (v === undefined) return undefined; if (!Array.isArray(v) || v.some((item) => typeof item !== "string")) throw new Error(`Proposal ${key} must be a string list.`); return v; }
function enumValue<T extends string>(value: Record<string, unknown>, key: string, allowed: readonly T[]): T | undefined { const v = value[key]; if (v === undefined) return undefined; if (typeof v !== "string" || !allowed.includes(v as T)) throw new Error(`Proposal ${key} is invalid.`); return v as T; }
