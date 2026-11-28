import type { IWorkspaceFs } from "@weaveforge/core";
import { FilePaperRepository } from "@/features/papers/infrastructure/file-paper-repository";
import { FileAnnotationPinRepository } from "@/features/papers/infrastructure/file-annotation-pin-repository";
import { FileNoteRepository } from "@/features/notes/infrastructure/file-note-repo";
import { FileMilestoneRepository } from "@/features/plan/infrastructure/file-milestone-repo";
import { FileReaderAnnotationRepository } from "@/features/reader/infrastructure/file-annotation-repository";
import { FileScreeningRepository } from "@/features/reading-lists/infrastructure/file-screening-repository";
import { WorkspaceListFilesPort } from "@/features/reading-lists/infrastructure/shell-list-files-port";
import type { SecretsStore } from "@/features/settings/infrastructure/parts";
import { FileAiAuditStore } from "./file-ai-audit-store";
import { FileAiProposalStore } from "./file-ai-proposal-store";
import { FileCitationAlertTrackRepository } from "./file-citation-alert-track-repo";
import { FileExperimentRepository } from "./file-experiment-repo";
import { FileLibraryPinRepository } from "./file-library-pin-repo";
import { FileLogEntryRepository } from "./file-log-entry-repo";
import { FileMetricRepository } from "./file-metric-repo";
import { FilePaperFieldRepository } from "./file-paper-field-repo";
import { FileProjectRepository } from "./file-project-repo";
import { FileReadingListItemRepository, FileReadingListRepository } from "./file-reading-list-repo";
import { FilePaperRelationRepository } from "./file-relation-repo";
import { FileReportSectionRepository } from "./file-report-section-repo";
import {
  FileBibliographyCollectionStore,
  FileIntegrationsStore,
  FileDashboardLayoutRepository,
  FileGraphSettingsRepository,
  FileQuotationTypeRepository,
  FileSettingsRepository,
} from "./file-settings-repos";
import { FilePaperTagRepository, FileTagRepository, type SettingsSection } from "./file-tag-repo";
import type { ProjectRoot } from "./file-entity-store";
import { clearScreensOnWrite } from "./clear-screens-on-write";

/**
 * Everything the file backend builds for one folder, keyed as the
 * `WiredPostgrestBackend` keys it replaces. Org and sharing rows (comments,
 * share links, members) are not here: they stay on PostgREST.
 */
export interface FileRepositories {
  readonly paperRepository: FilePaperRepository;
  readonly libraryPinRepository: FileLibraryPinRepository;
  readonly citationAlertTrackRepository: FileCitationAlertTrackRepository;
  readonly annotationPinRepository: FileAnnotationPinRepository;
  readonly tagRepository: FileTagRepository;
  readonly paperTagRepository: FilePaperTagRepository;
  readonly paperFieldRepository: FilePaperFieldRepository;
  readonly paperRelationRepository: FilePaperRelationRepository;
  readonly projectRepository: FileProjectRepository;
  readonly experimentRepository: FileExperimentRepository;
  readonly metricRepository: FileMetricRepository;
  readonly logEntryRepository: FileLogEntryRepository;
  readonly reportSectionRepository: FileReportSectionRepository;
  readonly readingListRepository: FileReadingListRepository;
  readonly readingListItemRepository: FileReadingListItemRepository;
  readonly rawVaultPageRepository: FileNoteRepository;
  readonly milestoneRepository: FileMilestoneRepository;
  readonly readerAnnotationRepository: FileReaderAnnotationRepository;
  readonly settingsRepository: FileSettingsRepository;
  readonly dashboardLayoutRepository: FileDashboardLayoutRepository;
  readonly graphSettingsRepository: FileGraphSettingsRepository;
  readonly quotationTypeRepository: FileQuotationTypeRepository;
  readonly bibliographyCollectionStore: FileBibliographyCollectionStore;
  readonly screeningRepository: FileScreeningRepository;
  readonly integrationsStore: FileIntegrationsStore;
  readonly aiProposalStore: FileAiProposalStore;
  readonly aiAuditStore: FileAiAuditStore;
}

export interface FileBackendParts {
  fs: IWorkspaceFs;
  /** The workspace settings file (`WorkspaceSettingsFile` satisfies this). */
  settings: SettingsSection;
  secrets: SecretsStore;
  /** The active project's folder, asked per call; "" (the workspace root) when left out. */
  projectRoot?: ProjectRoot;
}

/**
 * Builds every personal-data repository over one folder. Nothing here opens a
 * database or a network connection: the folder is the only store. `parts.fs`
 * must already be rooted at the chosen folder (the desktop bridge does that, and
 * tests pass memory), and repositories take paths relative to it, inside the
 * active project's folder (`parts.projectRoot`).
 */
export function wireFileBackend(parts: FileBackendParts): FileRepositories {
  const { settings, secrets } = parts;
  const fs = clearScreensOnWrite(parts.fs);
  const root: ProjectRoot = parts.projectRoot ?? (() => "");
  const papers = new FilePaperRepository(fs, root);
  const paperFields = new FilePaperFieldRepository(papers, settings, fs, root);
  return {
    paperRepository: papers,
    libraryPinRepository: new FileLibraryPinRepository(papers),
    citationAlertTrackRepository: new FileCitationAlertTrackRepository(settings),
    annotationPinRepository: new FileAnnotationPinRepository(fs, root),
    tagRepository: new FileTagRepository(papers, settings),
    paperTagRepository: new FilePaperTagRepository(papers),
    paperFieldRepository: paperFields,
    paperRelationRepository: new FilePaperRelationRepository(papers, fs, root),
    projectRepository: new FileProjectRepository(fs, (from, to) => paperFields.moveProjectFolder(from, to)),
    experimentRepository: new FileExperimentRepository(fs, root),
    metricRepository: new FileMetricRepository(fs, root),
    logEntryRepository: new FileLogEntryRepository(fs, root),
    reportSectionRepository: new FileReportSectionRepository(fs, root),
    readingListRepository: new FileReadingListRepository(fs, root),
    readingListItemRepository: new FileReadingListItemRepository(fs, root),
    rawVaultPageRepository: new FileNoteRepository(fs, root),
    milestoneRepository: new FileMilestoneRepository(fs, root),
    readerAnnotationRepository: new FileReaderAnnotationRepository(
      fs,
      root,
      (id) => papers.pathOf(id),
      () => papers.files(),
    ),
    settingsRepository: new FileSettingsRepository(settings, secrets),
    dashboardLayoutRepository: new FileDashboardLayoutRepository(settings),
    graphSettingsRepository: new FileGraphSettingsRepository(settings),
    quotationTypeRepository: new FileQuotationTypeRepository(settings),
    bibliographyCollectionStore: new FileBibliographyCollectionStore(settings),
    screeningRepository: new FileScreeningRepository(new WorkspaceListFilesPort(fs, root)),
    integrationsStore: new FileIntegrationsStore(settings, secrets),
    aiProposalStore: new FileAiProposalStore(fs),
    aiAuditStore: new FileAiAuditStore(fs),
  };
}
