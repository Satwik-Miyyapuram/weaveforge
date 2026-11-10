/**
 * Logbook list helpers (Rust `logbook::log_view`). Callers pass today as `yyyy-mm-dd` from
 * the local calendar, so the Rust side never reads the clock or a locale.
 */
import type {
  LogDayGroup,
  LogHeadlineSplit,
} from "./bindings.js";

export {
  groupByDay,
  logEyebrow,
  newestFirstOrder,
  streakDays,
} from "../pkg/wf_wasm.js";

export {
  splitHeadline,
} from "../pkg/wf_wasm.js";

export type { LogDayGroup, LogHeadlineSplit } from "./bindings.js";

