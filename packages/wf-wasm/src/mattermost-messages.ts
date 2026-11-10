/**
 * Mattermost channel messages (Rust `sync::mattermost_messages`). The caller formats
 * locale-dependent numbers (`toLocaleString`) and decimals (`String`) before passing them in.
 */
import {
  citationAlertMessage as rawCitationAlertMessage,
  logEntryMessage as rawLogEntryMessage,
  milestoneMessage as rawMilestoneMessage,
} from "../pkg/wf_wasm.js";
import type {
  CitationAlertInput,
  CitingPaperInput,
  ComputeLineInput,
  LogEntryMessageInput,
  MilestoneEvent,
  MilestoneMessageInput,
} from "./bindings.js";

export type {
  CitationAlertInput,
  CitingPaperInput,
  ComputeLineInput,
  LogEntryMessageInput,
  MilestoneEvent,
  MilestoneMessageInput,
} from "./bindings.js";

/** Channel message for a milestone event. */
export function milestoneMessage(input: MilestoneMessageInput): string {
  return rawMilestoneMessage(input);
}

/** Channel message for new citations of a tracked paper. */
export function citationAlertMessage(input: CitationAlertInput): string {
  return rawCitationAlertMessage(input);
}

/** Channel message for a log entry. */
export function logEntryMessage(input: LogEntryMessageInput): string {
  return rawLogEntryMessage(input);
}
