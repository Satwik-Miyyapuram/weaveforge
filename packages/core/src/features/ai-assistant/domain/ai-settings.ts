/** Types for ai-settings. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { AiAccessSettings } from "./ai-types.js";

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface AiSettingsFns {
  /** Normalize persisted AI access settings and fail closed for missing values. */
  normalizeAiAccessSettings(input?: Partial<AiAccessSettings>): AiAccessSettings;
}
