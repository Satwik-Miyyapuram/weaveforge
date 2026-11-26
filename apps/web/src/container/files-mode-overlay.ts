import { ManageSettingsUseCase, type IBlobFetcher } from "@weaveforge/core";
import type { BackendConfig } from "@/backend/parts";
import type { FileRepositories } from "@/backend/providers/files/wire-file-backend";
import { LocalAuthService, LocalSessionProvider } from "@/backend/providers/local/local-identity";
import { offlineDb } from "@/backend/providers/local/offline-db";
import { wirePostgrestBackend, type WiredPostgrestBackend } from "@/backend/providers/postgrest/wire-postgrest-backend";
import { systemClock } from "@/lib/parts";
import { FileModeBlobStore } from "./file-mode-blob-store";
import { readOnlyDb } from "./org-db-guard";
import { overlayFileRepositories } from "./with-file-repositories";

/**
 * Files mode on every platform (desktop, browser, Android): the one place the server backend is
 * guarded and overlaid. The database client is wrapped in readOnlyDb before any repository is built
 * on it, so a personal table write, a non-org rpc or a storage write outside the org buckets throws
 * before any request (allowlist: org-server-allowlist.ts). The personal repositories and the
 * settings use case are the file ones. Personal blobs (images, experiment files) go to `fileBlobs`
 * in the workspace folder; only the share path's `uploadShared` reaches the server blob store.
 *
 * Its own module, not with-file-repositories.ts: read-only-repositories.ts reads that module's
 * key lists at load, and the PostgREST wiring imported here reaches read-only-repositories.ts.
 *
 * `offline` (0.9.7 offline mode, no account): the server parts are the local user and a client
 * that refuses every call, so nothing reaches the network and no local database is opened.
 */
export function wireFilesMode(
  config: BackendConfig,
  projectContext: { projectId: string | null },
  pid: () => string | null,
  files: FileRepositories,
  fileBlobs: IBlobFetcher,
  offline = false,
): Omit<WiredPostgrestBackend, keyof FileRepositories> & FileRepositories & { filesMode: true } {
  const parts = offline
    ? {
        db: offlineDb(),
        session: new LocalSessionProvider(),
        auth: new LocalAuthService(),
        blobStore: fileBlobs,
        settingsRepository: files.settingsRepository,
        releaseNotices: { latest: async () => null },
      }
    : undefined;
  const postgrest = wirePostgrestBackend(config, projectContext, pid, parts, { filesMode: true }, readOnlyDb);
  return {
    ...overlayFileRepositories(postgrest, files),
    manageSettings: new ManageSettingsUseCase({ repository: files.settingsRepository, clock: systemClock }),
    rawBlobStore: new FileModeBlobStore(fileBlobs, postgrest.rawBlobStore),
    filesMode: true,
  };
}
