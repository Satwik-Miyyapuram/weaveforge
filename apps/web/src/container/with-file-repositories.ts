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
};

/**
 * Overlays the file repositories on a PostgREST-wired backend: each personal key
 * is replaced by its file counterpart, and every other key (org, sharing, db,
 * use cases) is kept as wired. Platform-neutral: desktop and the browser wiring
 * both use it.
 */
export function overlayFileRepositories<W extends object>(
  postgrestBackend: W,
  fileRepos: FileRepositories,
): W & FileRepositories {
  return { ...postgrestBackend, ...fileRepos };
}

/**
 * The keys of the wired PostgREST backend that stay on the server: org, sharing,
 * relay, auth and infrastructure. Any other key must be a personal key.
 */
export const SERVER_BACKEND_KEYS: ReadonlySet<string> = new Set([
  "config",
  "db",
  "session",
  "auth",
  "adminProvisioner",
  "projectContext",
  "releaseNoticesRepository",
  "manageSettings",
  "integrationsStore",
  "shareRepository",
  "commentRepository",
  "sharedReader",
  "memberRepository",
  "supervisionRepository",
  "projectBibliographyCollection",
  "rawBlobStore",
  "annotationQuotationTypeRepository",
  "labSnapshotRepository",
  "dispose",
]);

/** Keys of `wiredKeys` that are neither a personal key nor a listed server key. */
export function unclassifiedKeys(wiredKeys: readonly string[]): string[] {
  return wiredKeys.filter(
    (key) => !(key in PERSONAL_REPOSITORY_KEYS) && !SERVER_BACKEND_KEYS.has(key),
  );
}
