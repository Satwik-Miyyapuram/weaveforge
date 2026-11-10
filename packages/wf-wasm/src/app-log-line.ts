/**
 * Application log line formatting (Rust `app_log_line`), re-exported from index.ts.
 */
import { formatLogLine as rawFormatLogLine } from "../pkg/wf_wasm.js";

/** The fields of one log entry that a line is made from. */
/** Narrowing: no Rust struct; wasm takes positional args (format_log_line_js). */
export interface AppLogLineInput {
  at: string;
  level: string;
  source: string;
  message: string;
  detail?: string;
}

/** One entry as the text the panel and the log file both show. */
export function formatLogLine(entry: AppLogLineInput): string {
  return rawFormatLogLine(entry.at, entry.level, entry.source, entry.message, entry.detail);
}
