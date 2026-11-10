/**
 * Error reports (Rust `error_report`): redaction, and the prefilled "new issue"
 * address and body. Re-exported from index.ts.
 */
import {
  isNetworkFailure as rawIsNetworkFailure,
  maxReportChars as rawMaxReportChars,
  newIssueUrl as rawNewIssueUrl,
  redactReport as rawRedactReport,
  redactReportAndCap as rawRedactReportAndCap,
  reportMarkdown as rawReportMarkdown,
} from "../pkg/wf_wasm.js";
import type { Redacted, ReportMarkdown } from "./bindings.js";

/** Redacted text and how many spans were replaced (generated `Redacted`). */
export type { Redacted as RedactionOutcome } from "./bindings.js";
/** The fields of an issue body (generated `ReportMarkdown`). */
export type { ReportMarkdown as ReportMarkdownInput } from "./bindings.js";

/** Rust `MAX_REPORT_CHARS`, read at call time because the module must be initialised first. */
export function maxReportChars(): number {
  return rawMaxReportChars();
}

/** Redacts every sensitive span in `input` (Rust `redact_report`). */
export function redactReport(input: string): Redacted {
  return rawRedactReport(input) as Redacted;
}

/** Redacts, then keeps the result to `limit` UTF-16 units (Rust `redact_report_and_cap`). */
export function redactReportAndCap(input: string, limit: number): Redacted {
  return rawRedactReportAndCap(input, limit) as Redacted;
}

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

/** The prefilled "new issue" address for `body` on `repo`, cut to fit (Rust `new_issue_url`). */
export function newIssueUrl(title: string, body: string, repo: string): string {
  return rawNewIssueUrl(title, body, repo);
}

/** The issue body for a report (Rust `report_markdown`). */
export function reportMarkdown(input: ReportMarkdown): string {
  return rawReportMarkdown(input);
}

/** Whether `message` names a browser network failure (Rust `is_network_failure`). */
export function isNetworkFailure(message: string): boolean {
  return rawIsNetworkFailure(message);
}
