import type { IWorkspaceFs } from "@weaveforge/core";
import type { BackendConfig } from "@/backend/parts";
import { RefusingSecretsStore } from "@/backend/providers/files/refusing-secrets-store";
import { FileBlobStore } from "@/backend/providers/files/file-blob-store";
import { openFileSettingsSection } from "@/backend/providers/files/file-settings-section";
import { wireProjectFileBackend } from "@/backend/providers/files/project-file-repositories";
import { BrowserWorkspaceFs } from "@/features/workspace/infrastructure/parts";
import { browserReportVerified } from "@/features/migration-097/domain/report";
import { reportFolderSink } from "@/features/migration-097/infrastructure/report-folder-sink";
import { readOrCreateInstallId, type InstallIdFs } from "./browser-install-id";
import type { WiredBackend } from "./parts";
import { wireFilesMode } from "./files-mode-overlay";

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
  // The shared files-mode overlay (same as the desktop). Row scoping of shared images to the
  // signed-in user is not checked here.
  return (config, projectContext, pid) =>
    wireFilesMode(
      config,
      projectContext,
      pid,
      wireProjectFileBackend({ fs, settings, secrets: new RefusingSecretsStore() }, pid),
      new FileBlobStore(fs),
    );
}

/** The OPFS folder for the browser and Android WebView. Opened only when the migration allows files. */
export async function openBrowserFileWiring(): Promise<BrowserFileWiring> {
  return wireBrowserFiles(await BrowserWorkspaceFs.openOpfs());
}

/** The OPFS folder the report check reads (the report folder listing) and the install id is stored in. */
type ReportCheckFs = Parameters<typeof reportFolderSink>[0] & InstallIdFs;

/**
 * True only when the OPFS folder holds a clean verified 0.9.7 export for this browser install (its
 * own run is matched by its stable install id). The first call may write the install id, creating
 * it when none is stored. A failed write makes this return false, as does any other failure,
 * including no id.
 */
export async function browserReportOk(
  openFs: () => Promise<ReportCheckFs> = () => BrowserWorkspaceFs.openOpfs(),
): Promise<boolean> {
  try {
    const fs = await openFs();
    return await browserReportVerified(reportFolderSink(fs), await readOrCreateInstallId(fs));
  } catch {
    return false;
  }
}
