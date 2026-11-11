/**
 * Error reports (Rust `error_report`): redaction, and the prefilled "new issue"
 * address and body. Re-exported from index.ts.
 */
import {
  maxReportChars,
  redactReport,
  redactReportAndCap,
} from "../pkg/wf_wasm.js";
import type {
  Redacted,
  ReportMarkdown,
} from "./bindings.js";

export {
  isNetworkFailure,
  maxReportChars,
  newIssueUrl,
  redactReport,
  redactReportAndCap,
  reportMarkdown,
} from "../pkg/wf_wasm.js";

/** Redacted text and how many spans were replaced (generated `Redacted`). */
export type { Redacted as RedactionOutcome } from "./bindings.js";
/** The fields of an issue body (generated `ReportMarkdown`). */
export type { ReportMarkdown as ReportMarkdownInput } from "./bindings.js";

/** Redacts every sensitive span in `input` (same as `redactReport`). */
export function redact(input: string): Redacted {
  return redactReport(input);
}

/**
 * Redacts, then keeps the result to `limit` UTF-16 units, announcing any cut
 * (Rust `redact_and_cap`). The default is Rust's `MAX_REPORT_CHARS`.
 */
export function redactAndCap(input: string, limit: number = maxReportChars()): Redacted {
  return redactReportAndCap(input, Math.max(0, Math.floor(limit)));
}
