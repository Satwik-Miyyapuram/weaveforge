import type { BackendConfig } from "@/backend/parts";
import { secretsStoreFor } from "@/backend/providers/secrets-store";
import { wireFileBackend } from "@/backend/providers/files/wire-file-backend";
import type { SettingsSection } from "@/backend/providers/files/file-tag-repo";
import { wirePostgrestBackend } from "@/backend/providers/postgrest/wire-postgrest-backend";
import { DesktopWorkspaceFs, type VaultFileBridge } from "@/features/workspace/infrastructure/parts";
import type { WiredBackend } from "./parts";
import { overlayFileRepositories } from "./with-file-repositories";

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
      secrets: secretsStoreFor(postgrest.db),
    });
    return overlayFileRepositories(postgrest, files);
  };
}
