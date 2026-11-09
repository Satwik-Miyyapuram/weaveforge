/** Types for user-integration-credentials. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { UserSettings } from "./user-settings.js";

/** Provider-keyed credential bags stored on {@link UserSettings}. */
export type IntegrationCredentialBag = Record<string, string>;

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface UserIntegrationCredentialsFns {
  /** Read a provider field from the integrations bag or legacy flat columns. */
  getUserIntegrationField(settings: UserSettings, providerId: string, fieldId: string): string | undefined;
  /** True when the provider has at least one non-empty credential field. */
  isUserIntegrationConnected(settings: UserSettings, providerId: string, fieldIds: readonly string[]): boolean;
  /** Merge provider fields into settings (updates bag + legacy keys). */
  applyUserIntegrationFields(settings: UserSettings, providerId: string, fields: IntegrationCredentialBag): UserSettings;
  /** Build integrations bag from legacy flat columns (for reads after migration). */
  integrationsBagFromLegacy(settings: UserSettings): UserSettings["integrations"];
}
