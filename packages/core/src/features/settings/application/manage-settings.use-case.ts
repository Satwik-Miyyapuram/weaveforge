import {
  hydrateUserSettings,
  normalizeAppearance,
  normalizeUserSettings,
  type UserAppearance,
  type UserSettings,
} from "../domain/user-settings.js";
import type { SettingsMetadata } from "../domain/settings-repository.js";
import { CURRENT_DISCLAIMER_VERSION } from "../domain/privacy-disclaimer.js";
import type { ISettingsRepository } from "../domain/settings-repository.js";

export interface ManageSettingsDeps {
  repository: ISettingsRepository;
}

/** Load and persist per-user integration settings (normalized on save). */
export class ManageSettingsUseCase {
  constructor(private readonly deps: ManageSettingsDeps) {}

  async get(): Promise<UserSettings> {
    return hydrateUserSettings(await this.deps.repository.get());
  }

  async getMetadata(): Promise<SettingsMetadata> {
    return this.deps.repository.getMetadata();
  }

  async save(settings: UserSettings): Promise<void> {
    await this.deps.repository.save(normalizeUserSettings(settings));
  }

  async saveAppearance(appearance: UserAppearance): Promise<void> {
    const current = await this.get();
    await this.save({
      ...current,
      appearance: normalizeAppearance({ ...current.appearance, ...appearance }),
    });
  }

  async acceptDisclaimer(): Promise<void> {
    await this.deps.repository.saveDisclaimer(new Date().toISOString(), CURRENT_DISCLAIMER_VERSION);
  }
}
