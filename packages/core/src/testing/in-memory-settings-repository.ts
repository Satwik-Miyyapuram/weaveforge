import { EMPTY_SETTINGS, type UserSettings } from "../features/settings/domain/user-settings.js";
import type { ISettingsRepository } from "../features/settings/domain/settings-repository.js";

/** In-memory settings store for contract tests. Copies deeply, like a real store. */
export class InMemorySettingsRepository implements ISettingsRepository {
  private settings: UserSettings = structuredClone(EMPTY_SETTINGS);

  async get(): Promise<UserSettings> {
    return structuredClone(this.settings);
  }

  async getMetadata() {
    return {
      disclaimerAcceptedAt: this.settings.disclaimerAcceptedAt,
      disclaimerVersion: this.settings.disclaimerVersion,
      appearance: structuredClone(this.settings.appearance),
    };
  }

  async save(settings: UserSettings): Promise<void> {
    this.settings = structuredClone(settings);
  }

  async saveDisclaimer(acceptedAt: string, version: number): Promise<void> {
    this.settings = { ...this.settings, disclaimerAcceptedAt: acceptedAt, disclaimerVersion: version };
  }
}
