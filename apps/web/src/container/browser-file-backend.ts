import type { IWorkspaceFs } from "@weaveforge/core";
import type { BackendConfig } from "@/backend/parts";
import { RefusingSecretsStore } from "@/backend/providers/files/refusing-secrets-store";
import { openFileSettingsSection } from "@/backend/providers/files/file-settings-section";
import { wireFileBackend } from "@/backend/providers/files/wire-file-backend";
import { wirePostgrestBackend } from "@/backend/providers/postgrest/wire-postgrest-backend";
import { BrowserWorkspaceFs } from "@/features/workspace/infrastructure/parts";
import type { WiredBackend } from "./parts";
import { overlayFileRepositories } from "./with-file-repositories";

export type BrowserFileWiring = (
  config: BackendConfig,
  projectContext: { projectId: string | null },
  pid: () => string | null,
) => WiredBackend;

/**
 * The browser and Android personal-data backend: PostgREST with every personal repository
 * replaced by a file repository over `fs`. Org, sharing and relay rows stay on PostgREST.
 * Async because the settings file is read once before the synchronous `wireBackend` runs.
 */
export async function wireBrowserFiles(fs: IWorkspaceFs): Promise<BrowserFileWiring> {
  const settings = await openFileSettingsSection(fs, "");
  return (config, projectContext, pid) => {
    const postgrest = wirePostgrestBackend(config, projectContext, pid);
    const files = wireFileBackend({ fs, settings, secrets: new RefusingSecretsStore() });
    return overlayFileRepositories(postgrest, files);
  };
}

/** The OPFS folder for the browser and Android WebView. Opened only when the migration allows files. */
export async function openBrowserFileWiring(): Promise<BrowserFileWiring> {
  return wireBrowserFiles(await BrowserWorkspaceFs.openOpfs());
}
