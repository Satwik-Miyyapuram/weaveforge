/** Types for search-tuning. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

export type SearchField = "title" | "aliases" | "headings" | "tags" | "path" | "body";

export interface DocumentBoostOptions {
  /** Reference time for recency; injected so tests are deterministic. */
  now?: number;
  /** Half-life for the recency tiebreak. */
  recencyHalfLifeDays?: number;
  /** Multiplier from user settings (kind downranking). Defaults to 1. */
  kindMultiplier?: number;
  /** Set false to drop the recency tiebreak entirely. */
  recency?: boolean;
}

