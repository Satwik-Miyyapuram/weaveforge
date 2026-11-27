import { ManageSettingsUseCase } from "@weaveforge/core";
import { activeProjectFolder } from "@/backend/providers/files/active-project-folder";
import type { BackendConfig } from "@/backend/parts";
import { wireFileBackend } from "@/backend/providers/files/wire-file-backend";
import { NoAccountWorkspaceFs } from "@/backend/providers/files/no-account-fs";
import { DeviceSecretsStore } from "@/backend/device-secrets-store";
import { wirePostgrestBackend } from "@/backend/providers/postgrest/wire-postgrest-backend";
import { workspaceSettings } from "@/features/settings/application/workspace-settings";
import { systemClock } from "@/lib/parts";
import { overlayFileRepositories, type PersonalBackend } from "./with-file-repositories";
import { readOnlyDb } from "./read-only-repositories";
import { guardOrgDb } from "./org-db-guard";
import { FileBlobStore } from "@/backend/providers/files/file-blob-store";
import { FileModeBlobStore } from "./file-mode-blob-store";

/**
 * No-account mode (0.9.8): the personal repositories are file repositories over
 * the open folder, and org/sharing rows stay on PostgREST behind the org-table
 * and read-only guards, the same arrangement as the desktop file backend.
 */
export function wireNoAccountBackend(
  config: BackendConfig,
  projectContext: { projectId: string | null },
  pid: () => string | null,
): PersonalBackend {
  const postgrest = wirePostgrestBackend(config, projectContext, pid, undefined, { filesMode: true }, readOnlyDb);
  const fs = new NoAccountWorkspaceFs();
  const projectRoot = activeProjectFolder(projectContext);
  const files = wireFileBackend({ fs, projectRoot, settings: workspaceSettings, secrets: new DeviceSecretsStore() });
  return {
    ...overlayFileRepositories(postgrest, files),
    manageSettings: new ManageSettingsUseCase({ repository: files.settingsRepository, clock: systemClock }),
    // Personal blobs go to the folder; only the share path's uploadShared reaches the server store.
    rawBlobStore: new FileModeBlobStore(new FileBlobStore(fs, projectRoot), postgrest.rawBlobStore),
    // The container's client: tables and rpcs outside the org allowlist are refused, read or write, before any request.
    db: guardOrgDb(postgrest.db),
  };
}