import type { ManageSettingsUseCase } from "@weaveforge/core";
import { typedCore } from "@/lib/rust-core";

/** Async credential reader for integration adapters (DIP). */
export type IntegrationCredentialReader = (
  providerId: string,
  fieldId: string,
) => Promise<string | undefined>;

export function createCredentialReader(
  manageSettings: ManageSettingsUseCase,
): IntegrationCredentialReader {
  return async (providerId, fieldId) => {
    const settings = await manageSettings.get();
    return typedCore().getUserIntegrationField(settings, providerId, fieldId);
  };
}
