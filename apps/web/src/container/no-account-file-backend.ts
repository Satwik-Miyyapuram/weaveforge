import { ManageSettingsUseCase } from "@weaveforge/core";
import type { BackendConfig } from "@/backend/parts";
import { wireFileBackend } from "@/backend/providers/files/wire-file-backend";
import { NoAccountWorkspaceFs } from "@/backend/providers/files/no-account-fs";
import { DeviceSecretsStore } from "@/backend/device-secrets-store";
import { wirePostgrestBackend, type WiredPostgrestBackend } from "@/backend/providers/postgrest/wire-postgrest-backend";
import { workspaceSettings } from "@/features/settings/application/workspace-settings";
import { systemClock } from "@/lib/parts";
import { overlayFileRepositories } from "./with-file-repositories";
import { readOnlyDb } from "./read-only-repositories";

/**
 * No-account mode (0.9.8): the personal repositories are file repositories over
 * the open folder, and org/sharing rows stay on PostgREST behind the read-only
 * guard, the same arrangement as the desktop file backend.
 */
export function wireNoAccountBackend(
  config: BackendConfig,
  projectContext: { projectId: string | null },
  pid: () => string | null,
): WiredPostgrestBackend {
  const postgrest = wirePostgrestBackend(config, projectContext, pid, undefined, { filesMode: true }, readOnlyDb);
  const files = wireFileBackend({
    fs: new NoAccountWorkspaceFs(),
    settings: workspaceSettings,
    secrets: new DeviceSecretsStore(),
  });
  return {
    ...overlayFileRepositories(postgrest, files),
    manageSettings: new ManageSettingsUseCase({ repository: files.settingsRepository, clock: systemClock }),
  };
}