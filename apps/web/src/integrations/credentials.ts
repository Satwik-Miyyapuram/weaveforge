import type { ManageSettingsUseCase } from "@thesis/core";
import { getUserIntegrationField } from "@thesis/core";

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
