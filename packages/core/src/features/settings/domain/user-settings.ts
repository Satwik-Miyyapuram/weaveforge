/** Types for user-settings. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

import type { UserAppearance } from "./user-appearance.js";
import type { AiAccessSettings } from "../../ai-assistant/index.js";
import type { SearchSettings } from "../../../search/search-settings.js";

export type { UserAppearance, ControlSize } from "./user-appearance.js";

export interface UserSettings {
  /**
   * Provider-keyed credential bags (e.g. `{ zotero: { apiKey, library } }`).
   * Legacy flat columns remain in sync for existing DB rows.
   */
  integrations?: Record<string, Record<string, string>>;
  /** Zotero Web API key (zotero.org/settings/keys). */
  zoteroApiKey?: string;
  /** Zotero library path, e.g. "users/123456" or "groups/789". */
  zoteroLibrary?: string;
  /** Optional Semantic Scholar API key for higher rate limits. */
  semanticScholarKey?: string;
  /** ISO timestamp when the user accepted the org/privacy disclaimer. */
  disclaimerAcceptedAt?: string;
  /** Version of the disclaimer the user accepted (see CURRENT_DISCLAIMER_VERSION). */
  disclaimerVersion?: number;
  /** Light/dark mode and theme variant preferences. */
  appearance?: UserAppearance;
  /** Explicit, fail-closed access controls for the AI assistant. */
  aiAccess?: AiAccessSettings;
  /** Ranking preferences for workspace search. */
  search?: SearchSettings;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface UserSettingsFns {
  readonly EMPTY_SETTINGS: UserSettings;
  /** Merge integrations bag from legacy columns when loading from persistence. */
  hydrateUserSettings(settings: UserSettings): UserSettings;
  /** Trim strings and drop empties before persistence. */
  normalizeUserSettings(settings: UserSettings): UserSettings;
}
