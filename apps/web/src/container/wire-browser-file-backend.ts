import type { IWorkspaceFs } from "@weaveforge/core";
import { FileAnnotationPinRepository } from "@/features/papers/infrastructure/file-annotation-pin-repository";
import { FilePaperRepository } from "@/features/papers/infrastructure/file-paper-repository";
import { FileNoteRepository } from "@/features/notes/infrastructure/file-note-repo";
import { FileExperimentRepository } from "@/backend/providers/files/file-experiment-repo";
import { FileLogEntryRepository } from "@/backend/providers/files/file-log-entry-repo";
import { FileMetricRepository } from "@/backend/providers/files/file-metric-repo";
import { FilePaperFieldRepository } from "@/backend/providers/files/file-paper-field-repo";
import { FilePaperRelationRepository } from "@/backend/providers/files/file-relation-repo";
import { FileReadingListItemRepository, FileReadingListRepository } from "@/backend/providers/files/file-reading-list-repo";
import { FileReportSectionRepository } from "@/backend/providers/files/file-report-section-repo";
import { FileTagRepository } from "@/backend/providers/files/file-tag-repo";
import { openFileSettingsSection } from "@/backend/providers/files/file-settings-section";

/**
 * Personal data for the browser (OPFS) and Android WebView path. Every personal kind is a File*
 * repository over the workspace folder; the server database is only handed back as `orgDb` for
 * org and share data. Settings live in `.weaveforge/settings.json` (no secrets). The user-settings
 * repo that holds API keys is not wired yet: it waits for the FILES lane's secrets store.
 */
export async function wireBrowserFileBackend<Db>(fs: IWorkspaceFs, serverOrgDb: Db, root = "") {
  const projectRoot = () => root;
  const settings = await openFileSettingsSection(fs, root);
  const papers = new FilePaperRepository(fs, root);
  return {
    orgDb: serverOrgDb,
    settings,
    notes: new FileNoteRepository(fs, root),
    papers,
    tags: new FileTagRepository(papers, settings),
    paperFields: new FilePaperFieldRepository(papers, settings, fs, projectRoot),
    annotationPins: new FileAnnotationPinRepository(fs, root),
    logEntries: new FileLogEntryRepository(fs, projectRoot),
    experiments: new FileExperimentRepository(fs, projectRoot),
    metrics: new FileMetricRepository(fs, projectRoot),
    reportSections: new FileReportSectionRepository(fs, projectRoot),
    readingLists: new FileReadingListRepository(fs, projectRoot),
    readingListItems: new FileReadingListItemRepository(fs, projectRoot),
    relations: new FilePaperRelationRepository(papers, fs, projectRoot),
  };
}

