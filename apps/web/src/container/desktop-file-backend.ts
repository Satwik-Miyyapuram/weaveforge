import { ManageSettingsUseCase } from "@weaveforge/core";
import type { BackendConfig } from "@/backend/parts";
import { wireFileBackend } from "@/backend/providers/files/wire-file-backend";
import type { SettingsSection } from "@/backend/providers/files/file-tag-repo";
import type { Secrets, SecretsStore } from "@/features/settings/infrastructure/parts";
import { wirePostgrestBackend } from "@/backend/providers/postgrest/wire-postgrest-backend";
import { DesktopWorkspaceFs, type VaultFileBridge } from "@/features/workspace/infrastructure/parts";
import { systemClock } from "@/lib/parts";
import type { WiredBackend } from "./parts";
import { overlayFileRepositories } from "./with-file-repositories";
import { readOnlyDb } from "./read-only-repositories";

/**
 * Integration credentials for the desktop window, held in memory for this
 * session only. Never the database: the desktop must not write secrets to one.
 * TODO(KEYS): the OS keychain store replaces this and survives restarts.
 */
class SessionSecretsStore implements SecretsStore {
  private current: Secrets = {};
  async load(): Promise<Secrets> {
    return this.current;
  }
  async save(secrets: Secrets): Promise<void> {
    this.current = secrets;
  }
}

/**
 * The desktop's personal-data backend for 0.9.7: the PostgREST backend with its
 * personal repositories replaced by file repositories over the shell's vault.
 * Org, sharing and relay rows stay on PostgREST.
 *
 * The shell is already rooted at the chosen folder, so the file repositories
 * need no folder to be connected yet; they only run when the migration is
 * verified, and the folder reload rewires them when it changes.
 */
export function wireDesktopFileBackend(
  bridge: VaultFileBridge,
  settings: SettingsSection,
): (config: BackendConfig, projectContext: { projectId: string | null }, pid: () => string | null) => WiredBackend {
  return (config, projectContext, pid) => {
    const postgrest = wirePostgrestBackend(config, projectContext, pid);
    const files = wireFileBackend({
      fs: new DesktopWorkspaceFs(bridge),
      settings,
      secrets: new SessionSecretsStore(),
    });
    // Settings writes must reach the folder: the use case is rebuilt over the file repository.
    // The database client stays live for org and sharing tables only: personal table writes and
    // non-org rpcs are refused (readOnlyDb's rule), so no personal write can reach the server.
    return {
      ...overlayFileRepositories(postgrest, files),
      db: readOnlyDb(postgrest.db),
      manageSettings: new ManageSettingsUseCase({ repository: files.settingsRepository, clock: systemClock }),
    };
  };
}
