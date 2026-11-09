/** Types for privacy-disclaimer. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { UserSettings } from "./user-settings.js";

/** Bump when disclaimer copy changes materially — users must re-accept. */
export const CURRENT_DISCLAIMER_VERSION = 5;

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface PrivacyDisclaimerFns {
  needsDisclaimerAcceptance(settings: UserSettings): boolean;
}
