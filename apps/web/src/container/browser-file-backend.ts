import { ManageSettingsUseCase, type IWorkspaceFs } from "@weaveforge/core";
import { systemClock } from "@/lib/parts";
import type { BackendConfig } from "@/backend/parts";
import { RefusingSecretsStore } from "@/backend/providers/files/refusing-secrets-store";
import { FileBlobStore } from "@/backend/providers/files/file-blob-store";
import { openFileSettingsSection } from "@/backend/providers/files/file-settings-section";
import { wireFileBackend } from "@/backend/providers/files/wire-file-backend";
import { wirePostgrestBackend } from "@/backend/providers/postgrest/wire-postgrest-backend";
import { BrowserWorkspaceFs } from "@/features/workspace/infrastructure/parts";
import { browserReportVerified } from "@/features/migration-097/domain/report";
import type { WiredBackend } from "./parts";
import { guardOrgDb } from "./org-db-guard";
import { overlayFileRepositories } from "./with-file-repositories";

/** A backend whose personal data lives in files: `filesMode` is always true here. */
export type BrowserFileBackend = WiredBackend & { filesMode: true };

export type BrowserFileWiring = (
  config: BackendConfig,
  projectContext: { projectId: string | null },
  pid: () => string | null,
) => BrowserFileBackend;

/**
 * The browser and Android personal-data backend: PostgREST with every personal repository
 * replaced by a file repository over `fs`. Org, sharing and relay rows stay on PostgREST.
 * Async because the settings file is read once before the synchronous `wireBackend` runs.
 */
export async function wireBrowserFiles(fs: IWorkspaceFs): Promise<BrowserFileWiring> {
  const settings = await openFileSettingsSection(fs, "");
  return (config, projectContext, pid) => {
    const postgrest = wirePostgrestBackend(config, projectContext, pid, undefined, { filesMode: true });
    const files = wireFileBackend({ fs, settings, secrets: new RefusingSecretsStore() });
    // The container reaches the server only through `db`, so the guard sits there: personal
    // tables and rpcs throw before any request. Org and share tables stay reachable.
    // manageSettings is built inside wirePostgrestBackend over the server settings repo. Rebuild it
    // over the file repo, so settings saves and the credential readers never reach PostgREST.
    const manageSettings = new ManageSettingsUseCase({ repository: files.settingsRepository, clock: systemClock });
    return {
      ...overlayFileRepositories(postgrest, files),
      manageSettings,
      // Personal blobs (images, experiment files) go to the OPFS file blob store, not blob_objects.
      // blob_objects stays allowlisted on the org server because shared images still use it.
      // Row scoping of shared images to the signed-in user is not checked here.
      rawBlobStore: new FileBlobStore(fs),
      db: guardOrgDb(postgrest.db),
      filesMode: true,
    };
  };
}

/** The OPFS folder for the browser and Android WebView. Opened only when the migration allows files. */
export async function openBrowserFileWiring(): Promise<BrowserFileWiring> {
  return wireBrowserFiles(await BrowserWorkspaceFs.openOpfs());
}

/** True only when the OPFS folder holds a clean verified 0.9.7 export. Any failure reads as false. */
export async function browserReportOk(): Promise<boolean> {
  try {
    return await browserReportVerified(await BrowserWorkspaceFs.openOpfs());
  } catch {
    return false;
  }
}
