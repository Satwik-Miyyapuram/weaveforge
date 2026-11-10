/**
 * AI write-proposal payload readers (Rust `ai::proposal_inputs`), re-exported from index.ts.
 * Keeps the messages of apps/web/src/features/ai-assistant/application/proposal-executors.ts.
 * A refused payload throws an Error with that message.
 */
import type {
  ExperimentFollowUpInput,
  PaperAnnotationInput,
  PaperFieldDefInput,
  PaperFieldFillInput,
  PaperUpdateInput,
  ProposalLogEntryInput,
  ProposalMilestoneInput,
  ProposalZoteroPaperInput,
  ReadingListChangeInput,
  RelationInput,
  VaultNoteEditInput,
  VaultNoteInput,
} from "./bindings.js";
import {
  proposalAppendVaultNoteBody as rawAppendVaultNoteBody,
  proposalEditVaultNote as rawEditVaultNote,
  proposalExperimentFollowUp as rawExperimentFollowUp,
  proposalExperimentUpdate as rawExperimentUpdate,
  proposalLogEntry as rawLogEntry,
  proposalMilestoneFollowUp as rawMilestoneFollowUp,
  proposalMilestoneStatus as rawMilestoneStatus,
  proposalPaperAnnotation as rawPaperAnnotation,
  proposalPaperFieldFill as rawPaperFieldFill,
  proposalPaperFieldId as rawPaperFieldId,
  proposalPaperNoteAddition as rawPaperNoteAddition,
  proposalPaperUpdate as rawPaperUpdate,
  proposalReadingListChange as rawReadingListChange,
  proposalRelation as rawRelation,
  proposalReportNotes as rawReportNotes,
  proposalVaultNote as rawVaultNote,
  proposalZoteroImport as rawZoteroImport,
} from "../pkg/wf_wasm.js";

/** The paper note's addition: the payload's `addition` when a string, else `content`. */
export function proposalPaperNoteAddition(payload: unknown, content: string): string {
  return rawPaperNoteAddition(payload, content);
}

/** Create-vault-note input. */
export function proposalVaultNote(payload: unknown): VaultNoteInput {
  return rawVaultNote(payload) as VaultNoteInput;
}

/** Create-log-entry input. */
export function proposalLogEntry(payload: unknown): ProposalLogEntryInput {
  return rawLogEntry(payload) as ProposalLogEntryInput;
}

/** Paper-update input. */
export function proposalPaperUpdate(payload: unknown): PaperUpdateInput {
  return rawPaperUpdate(payload) as PaperUpdateInput;
}

/** The `fieldId` of a paper-field payload, read before the host lists the fields. */
export function proposalPaperFieldId(payload: unknown): string {
  return rawPaperFieldId(payload);
}

/** The checked paper-field write, given the listed field definitions. */
export function proposalPaperFieldFill(payload: unknown, defs: readonly PaperFieldDefInput[]): PaperFieldFillInput {
  return rawPaperFieldFill(payload, [...defs]) as PaperFieldFillInput;
}

/** Reading-list change: exactly one paper or vault-note target. */
export function proposalReadingListChange(payload: unknown): ReadingListChangeInput {
  return rawReadingListChange(payload) as ReadingListChangeInput;
}

/** Relation input. */
export function proposalRelation(payload: unknown): RelationInput {
  return rawRelation(payload) as RelationInput;
}

/** Zotero import input (the paper fields a draft may set). */
export function proposalZoteroImport(payload: unknown): ProposalZoteroPaperInput {
  return rawZoteroImport(payload) as ProposalZoteroPaperInput;
}

/** Milestone follow-up input. */
export function proposalMilestoneFollowUp(payload: unknown): ProposalMilestoneInput {
  return rawMilestoneFollowUp(payload) as ProposalMilestoneInput;
}

/** Experiment follow-up input. */
export function proposalExperimentFollowUp(payload: unknown): ExperimentFollowUpInput {
  return rawExperimentFollowUp(payload) as ExperimentFollowUpInput;
}

/** Note edit: the title and/or body to set. The body is kept as sent. */
export function proposalEditVaultNote(payload: unknown): VaultNoteEditInput {
  return rawEditVaultNote(payload) as VaultNoteEditInput;
}

/** The note's new body after an append: the addition joined after the trimmed existing body. */
export function proposalAppendVaultNoteBody(existing: string, payload: unknown): string {
  return rawAppendVaultNoteBody(existing, payload);
}

/** Report notes to set. Only a string is accepted. */
export function proposalReportNotes(payload: unknown): string {
  return rawReportNotes(payload);
}

/** Milestone status to set. */
export function proposalMilestoneStatus(payload: unknown): string {
  return rawMilestoneStatus(payload);
}

/**
 * Experiment update: status, metrics and artifacts. Generic until the Rust type carries specta
 * bindings (the metrics object is free-form), as the model-concept wrappers are.
 */
export function proposalExperimentUpdate<Update>(payload: unknown): Update {
  return rawExperimentUpdate(payload) as Update;
}

/** Quote-anchored paper annotation input. */
export function proposalPaperAnnotation(payload: unknown): PaperAnnotationInput {
  return rawPaperAnnotation(payload) as PaperAnnotationInput;
}
