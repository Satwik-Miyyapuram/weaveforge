/**
 * AI write-proposal payload readers (Rust `ai::proposal_inputs`), re-exported from index.ts.
 * Keeps the messages of apps/web/src/features/ai-assistant/application/proposal-executors.ts.
 * A refused payload throws an Error with that message.
 */
import type {
  PaperFieldDefInput,
  PaperFieldFillInput,
} from "./bindings.js";
import {
  proposalExperimentUpdate as rawExperimentUpdate,
  proposalPaperFieldFill as rawPaperFieldFill,
} from "../pkg/wf_wasm.js";

export {
  proposalAppendVaultNoteBody,
  proposalEditVaultNote,
  proposalExperimentFollowUp,
  proposalLogEntry,
  proposalMilestoneFollowUp,
  proposalMilestoneStatus,
  proposalPaperAnnotation,
  proposalPaperFieldId,
  proposalPaperNoteAddition,
  proposalPaperUpdate,
  proposalReadingListChange,
  proposalRelation,
  proposalReportNotes,
  proposalVaultNote,
  proposalZoteroImport,
} from "../pkg/wf_wasm.js";

/** The checked paper-field write, given the listed field definitions. */
export function proposalPaperFieldFill(payload: unknown, defs: readonly PaperFieldDefInput[]): PaperFieldFillInput {
  return rawPaperFieldFill(payload, [...defs]) as PaperFieldFillInput;
}

/**
 * Experiment update: status, metrics and artifacts. Generic until the Rust type carries specta
 * bindings (the metrics object is free-form), as the model-concept wrappers are.
 */
export function proposalExperimentUpdate<Update>(payload: unknown): Update {
  return rawExperimentUpdate(payload) as Update;
}

