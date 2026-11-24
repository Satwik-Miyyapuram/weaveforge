import type { BackendConfig } from "@/backend/parts";
import { FileBlobStore } from "@/backend/providers/files/file-blob-store";
import { wireProjectFileBackend } from "@/backend/providers/files/project-file-repositories";
import type { SettingsSection } from "@/backend/providers/files/file-tag-repo";
import type { SecretsStore } from "@/features/settings/infrastructure/parts";
import { DeviceSecretsStore } from "@/backend/providers/local/parts";
import type { WiredPostgrestBackend } from "@/backend/providers/postgrest/wire-postgrest-backend";
import { DesktopWorkspaceFs, type VaultFileBridge } from "@/features/workspace/infrastructure/parts";
import { wireFilesMode } from "./files-mode-overlay";

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
  // Offline mode (no account): no server client at all, see wireFilesMode.
  offline = false,
): (config: BackendConfig, projectContext: { projectId: string | null }, pid: () => string | null) => WiredPostgrestBackend {
  return (config, projectContext, pid) => {
    const fs = new DesktopWorkspaceFs(bridge);
    // The shared files-mode overlay (same as the browser): guarded db, file repositories, and
    // personal blobs in the vault's assets folder instead of the server blob store.
    return wireFilesMode(config, projectContext, pid, wireProjectFileBackend({ fs, settings, secrets }, pid), new FileBlobStore(fs), offline);
  };
}
