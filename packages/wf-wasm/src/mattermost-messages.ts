/**
 * Mattermost channel messages (Rust `sync::mattermost_messages`). The caller formats
 * locale-dependent numbers (`toLocaleString`) and decimals (`String`) before passing them in.
 */
import type {
  CitationAlertInput,
  CitingPaperInput,
  ComputeLineInput,
  LogEntryMessageInput,
  MilestoneEvent,
  MilestoneMessageInput,
} from "./bindings.js";

export {
  citationAlertMessage,
  logEntryMessage,
  milestoneMessage,
} from "../pkg/wf_wasm.js";

export type {
  CitationAlertInput,
  CitingPaperInput,
  ComputeLineInput,
  LogEntryMessageInput,
  MilestoneEvent,
  MilestoneMessageInput,
} from "./bindings.js";

