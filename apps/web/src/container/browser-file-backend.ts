import { ManageSettingsUseCase, type IWorkspaceFs } from "@weaveforge/core";
import { systemClock } from "@/lib/parts";
import type { BackendConfig } from "@/backend/parts";
import { RefusingSecretsStore } from "@/backend/providers/files/refusing-secrets-store";
import { FileBlobStore } from "@/backend/providers/files/file-blob-store";
import { FileModeBlobStore } from "./file-mode-blob-store";
import { openFileSettingsSection } from "@/backend/providers/files/file-settings-section";
import { wireFileBackend } from "@/backend/providers/files/wire-file-backend";
import { wirePostgrestBackend } from "@/backend/providers/postgrest/wire-postgrest-backend";
import { BrowserWorkspaceFs } from "@/features/workspace/infrastructure/parts";
import type { WiredBackend } from "./parts";
import { guardOrgDb } from "./org-db-guard";
import { readOnlyDb } from "./read-only-repositories";
import { overlayFileRepositories } from "./with-file-repositories";

/** A backend wired in files mode: its personal repositories are file repositories, marked so callers can tell. */
export type BrowserFileBackend = WiredBackend & { readonly filesMode: true };

export type BrowserFileWiring = ((
  config: BackendConfig,
  projectContext: { projectId: string | null },
  pid: () => string | null,
) => BrowserFileBackend) & {
  /** Releases what the wiring opened. The OPFS handle needs no release, so this is a no-op today. */
  close(): Promise<void>;
};

/**
 * The browser and Android personal-data backend: PostgREST with every personal repository
 * replaced by a file repository over `fs`. Org, sharing and relay rows stay on PostgREST.
 * Async because the settings file is read once before the synchronous `wireBackend` runs.
 */
export async function wireBrowserFiles(fs: IWorkspaceFs): Promise<BrowserFileWiring> {
  const settings = await openFileSettingsSection(fs, "");
  const build: (
    config: BackendConfig,
    projectContext: { projectId: string | null },
    pid: () => string | null,
  ) => BrowserFileBackend = (config, projectContext, pid) => {
    // Files mode guards `db` and every repository the wiring builds on the server client, so personal
    // tables and rpcs throw before any request. Org and share tables stay reachable. readOnlyDb
    // refuses writes outside the org write tables, as on desktop and no-account.
    const postgrest = wirePostgrestBackend(config, projectContext, pid, undefined, { filesMode: true }, readOnlyDb);
    const files = wireFileBackend({ fs, settings, secrets: new RefusingSecretsStore() });
    // manageSettings is built inside wirePostgrestBackend over the server settings repo. Rebuild it
    // over the file repo, so settings saves and the credential readers never reach PostgREST.
    const manageSettings = new ManageSettingsUseCase({ repository: files.settingsRepository, clock: systemClock });
    return {
      ...overlayFileRepositories(postgrest, files),
      filesMode: true,
      manageSettings,
      // Personal blobs (images, experiment files) go to the OPFS file blob store. Only the share
      // path's `uploadShared` reaches the server blob store. Row scoping of shared images to the
      // signed-in user is not checked here.
      rawBlobStore: new FileModeBlobStore(new FileBlobStore(fs), postgrest.rawBlobStore),
      db: guardOrgDb(postgrest.db),
    };
  };
  return Object.assign(build, { close: async () => {} });
}

export const BROWSER_STORAGE_MESSAGE =
  "This browser's storage could not be opened, so your notes cannot load. Allow site storage (not a private window) and reload.";

/**
 * The OPFS folder for the browser and Android WebView: their personal-data backend.
 * A failure is rethrown with a clear message; nothing falls back to the server.
 */
export async function openBrowserFileWiring(
  open: () => Promise<IWorkspaceFs> = () => BrowserWorkspaceFs.openOpfs(),
): Promise<BrowserFileWiring> {
  try {
    return await wireBrowserFiles(await open());
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${BROWSER_STORAGE_MESSAGE} (${detail})`, { cause: error });
  }
}
