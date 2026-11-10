/**
 * Log-entry row mapping (Rust `logbook::log_entry_row`). The rows are the `log_entries` columns;
 * both backend providers read and write the same table through the repositories in the web app.
 */
import type {
  LogEntryRow,
  LogEntryWriteRow,
} from "./bindings.js";

export {
  logEntryToDomain,
  logEntryToRow,
} from "../pkg/wf_wasm.js";

export type { LogEntryRow, LogEntryWriteRow } from "./bindings.js";

