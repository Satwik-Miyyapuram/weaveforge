import type { ManageSettingsUseCase } from "@weaveforge/core";
import { getUserIntegrationField } from "@weaveforge/core";

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
    return getUserIntegrationField(settings, providerId, fieldId);
  };
}
