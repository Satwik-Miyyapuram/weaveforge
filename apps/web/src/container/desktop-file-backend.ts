import { ManageSettingsUseCase } from "@weaveforge/core";
import { activeProjectFolder } from "@/backend/providers/files/active-project-folder";
import type { BackendConfig } from "@/backend/parts";
import { wireFileBackend } from "@/backend/providers/files/wire-file-backend";
import type { SettingsSection } from "@/backend/providers/files/file-tag-repo";
import type { SecretsStore } from "@/features/settings/infrastructure/parts";
import { DeviceSecretsStore } from "@/backend/device-secrets-store";
import { wirePostgrestBackend } from "@/backend/providers/postgrest/wire-postgrest-backend";
import { DesktopWorkspaceFs, type VaultFileBridge } from "@/features/workspace/infrastructure/parts";
import { systemClock } from "@/lib/parts";
import { overlayFileRepositories, type PersonalBackend } from "./with-file-repositories";
import { readOnlyDb } from "./read-only-repositories";
import { guardOrgDb } from "./org-db-guard";
import { FileBlobStore } from "@/backend/providers/files/file-blob-store";
import { FileModeBlobStore } from "./file-mode-blob-store";

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
  // Credentials live in the OS keychain (one entry per field): they survive a restart and never reach a file or the server.
  secrets: SecretsStore = new DeviceSecretsStore(),
): (config: BackendConfig, projectContext: { projectId: string | null }, pid: () => string | null) => PersonalBackend {
  return (config, projectContext, pid) => {
    // The client is guarded before the repositories are built on it, so no repository holds the raw one.
    const postgrest = wirePostgrestBackend(config, projectContext, pid, undefined, { filesMode: true }, readOnlyDb);
    const fs = new DesktopWorkspaceFs(bridge);
    const projectRoot = activeProjectFolder(projectContext);
    const files = wireFileBackend({ fs, projectRoot, settings, secrets });
    // Settings writes must reach the folder: the use case is rebuilt over the file repository.
    // The container's database client (db) stays live for org and sharing tables only. 0.9.8:
    // guardOrgDb refuses every table and rpc outside the org allowlist, read or write, before any
    // request; readOnlyDb (above) still refuses writes outside the org write tables. In files mode
    // wirePostgrestBackend builds its own repositories over the same guarded client.
    return {
      ...overlayFileRepositories(postgrest, files),
      manageSettings: new ManageSettingsUseCase({ repository: files.settingsRepository, clock: systemClock }),
      // Personal blobs go to the folder; only the share path's uploadShared reaches the server store.
      rawBlobStore: new FileModeBlobStore(new FileBlobStore(fs, projectRoot), postgrest.rawBlobStore),
      db: guardOrgDb(postgrest.db),
    };
  };
}
