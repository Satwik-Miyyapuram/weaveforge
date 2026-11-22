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
};

/**
 * Overlays the file repositories on a PostgREST-wired backend: each personal key
 * is replaced by its file counterpart, and every other key (org, sharing, db,
 * use cases) is kept as wired.
 */
export function withFileRepositories<W extends object>(
  wired: W,
  files: FileRepositories,
): Omit<W, keyof FileRepositories> & FileRepositories {
  return { ...wired, ...files } as Omit<W, keyof FileRepositories> & FileRepositories;
}
