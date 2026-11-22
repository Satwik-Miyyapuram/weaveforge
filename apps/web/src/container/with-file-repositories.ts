import type { FileRepositories } from "@/backend/providers/files/wire-file-backend";

/**
 * Every personal-data key of the file backend. The record is typed over
 * `keyof FileRepositories`, so adding a repository fails to compile until it is
 * listed here, and the test compares these keys with what wireFileBackend builds.
 */
export const PERSONAL_REPOSITORY_KEYS: Record<keyof FileRepositories, true> = {
  paperRepository: true,
  libraryPinRepository: true,
  citationAlertTrackRepository: true,
  annotationPinRepository: true,
  tagRepository: true,
  paperTagRepository: true,
  paperFieldRepository: true,
  paperRelationRepository: true,
  projectRepository: true,
  experimentRepository: true,
  metricRepository: true,
  logEntryRepository: true,
  reportSectionRepository: true,
  readingListRepository: true,
  readingListItemRepository: true,
  rawVaultPageRepository: true,
  milestoneRepository: true,
  readerAnnotationRepository: true,
  settingsRepository: true,
  dashboardLayoutRepository: true,
  graphSettingsRepository: true,
  quotationTypeRepository: true,
  bibliographyCollectionStore: true,
  screeningRepository: true,
  integrationsStore: true,
};

/**
 * Wired PostgREST key names whose personal counterpart is a file repository under
 * another name: the overlay points the wired key at the file repository.
 */
export const PERSONAL_ALIASES: Record<string, keyof FileRepositories> = {
  projectBibliographyCollection: "bibliographyCollectionStore",
  annotationQuotationTypeRepository: "quotationTypeRepository",
};

/**
 * Overlays the file repositories on a PostgREST-wired backend: each personal key
 * is replaced by its file counterpart (aliases included), and every other key (org,
 * sharing, db, use cases) is kept as wired. Platform-neutral: desktop and the browser
 * wiring both use it.
 */
export function overlayFileRepositories<W extends object>(
  postgrestBackend: W,
  fileRepos: FileRepositories,
): W & FileRepositories {
  const aliased = Object.fromEntries(
    Object.entries(PERSONAL_ALIASES).map(([alias, target]) => [alias, fileRepos[target]]),
  );
  return { ...postgrestBackend, ...fileRepos, ...aliased } as W & FileRepositories;
}

/**
 * The keys of the wired PostgREST backend that stay on the server: org, sharing,
 * relay, auth and infrastructure. Any other key must be a personal key or alias.
 */
export const SERVER_BACKEND_KEYS: ReadonlySet<string> = new Set([
  "config", // backend connection settings, not user data
  "db", // database client; guarded by readOnlyDb in read-only mode
  "session", // current-user identity provider, not stored data
  "auth", // sign-in service (Supabase), not stored data
  "adminProvisioner", // org admin provisioning on the server
  "projectContext", // active project id, not stored data
  "releaseNoticesRepository", // release notices are published by the server, not user data
  "manageSettings", // settings use case; the desktop overlay rebuilds it over the file settings repo
  "shareRepository", // share links live on the org server
  "commentRepository", // shared comment threads live on the org server
  "sharedReader", // reads content shared through the org server
  "memberRepository", // org membership
  "supervisionRepository", // supervisor sharing lives on the org server
  "rawBlobStore", // shared blob storage on the org server
  "labSnapshotRepository", // lab snapshots are shared org data
  "dispose", // lifecycle hook for the wired backend, not data
]);

/** Keys of `wiredKeys` that are neither a personal key, an alias nor a listed server key. */
export function unclassifiedKeys(wiredKeys: readonly string[]): string[] {
  return wiredKeys.filter(
    (key) => !(key in PERSONAL_REPOSITORY_KEYS) && !(key in PERSONAL_ALIASES) && !SERVER_BACKEND_KEYS.has(key),
  );
}
