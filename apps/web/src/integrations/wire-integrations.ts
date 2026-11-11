import { getAppConfig } from "@/deployment/app-config";
import type { IGitClient, IIntegrationsStore, Integration } from "@/features/sync/domain/parts";
import type { ProjectContext } from "@/lib/project-context";
import type {
  AddPaperUseCase,
  BibliographyAnnotationPull,
  BibliographyCollection,
  BibliographyCredentials,
  BibliographySyncResult,
  CitationCandidate,
  IBibliographyIntegration,
  ILogSyncIntegration,
  IMetadataSource,
  INotificationIntegration,
  IPaperRepository,
  IProjectBibliographyCollectionStore,
  ISettingsRepository,
  LogEntry,
  ManageSettingsUseCase,
  ManageTagsUseCase,
  Milestone,
  Paper,
} from "@weaveforge/core";
import { type IntegrationConfig, readIntegrationConfig } from "./config";
import {
  findBibliographyManifest,
  findLogSyncManifest,
  findNotificationManifest,
} from "./manifests/types";
import type { IntegrationsRegistry } from "./parts";

// --- noop-bibliography-integration ---
/** Disabled bibliography provider — safe no-ops for local-only deployments. */
export class NoopBibliographyIntegration implements IBibliographyIntegration {
  readonly providerId = "none";

  async syncLibrary(): Promise<BibliographySyncResult> {
    return { pushed: 0, pulled: 0, deletedLocal: 0 };
  }

  async pullAnnotations(): Promise<BibliographyAnnotationPull> {
    return { byPaper: new Map(), attachments: new Map() };
  }

  async pushPaper(_paper: Paper): Promise<string | undefined> {
    return undefined;
  }

  async removeRemotePaper(_remoteKey: string): Promise<void> {
    /* no remote library */
  }

  async listCollections(
    _credentials?: BibliographyCredentials,
  ): Promise<BibliographyCollection[]> {
    return [];
  }
}

// --- noop-git-client ---
/** Used when NEXT_PUBLIC_GIT_READ_PROVIDERS=none — Git tab is hidden. */
export class NoopGitClient implements IGitClient {
  async listCommits(_integration: Integration, _branch?: string) {
    return [];
  }

  async listBranches(_integration: Integration) {
    return [];
  }
}

// --- noop-log-sync-integration ---
/** Disabled log-sync provider. */
export class NoopLogSyncIntegration implements ILogSyncIntegration {
  readonly providerId = "none";

  async pushLog(_entry: LogEntry): Promise<void> {
    /* log sync off */
  }

  async removeLog(_entry: LogEntry): Promise<void> {
    /* log sync off */
  }
}

// --- noop-notification-integration ---
/** Disabled notification provider. */
export class NoopNotificationIntegration implements INotificationIntegration {
  readonly providerId = "none";

  async notifyMilestone(_event: "added" | "status", _milestone: Milestone): Promise<void> {
    /* notifications off */
  }

  async notifyCitationAlert(_tracked: Paper, _citing: CitationCandidate[]): Promise<void> {
    /* notifications off */
  }

  async notifyLogEntry(_entry: LogEntry): Promise<void> {
    /* notifications off */
  }
}

// --- noop-project-bibliography-collection-store ---
/** No per-project bibliography collection when bibliography integration is disabled. */
export class NoopProjectBibliographyCollectionStore implements IProjectBibliographyCollectionStore {
  async getCollection(_projectId: string): Promise<string | undefined> {
    return undefined;
  }

  async setCollection(_projectId: string, _collectionKey: string | null): Promise<void> {
    /* no-op */
  }
}

// --- wire-integrations-deps ---
export interface WireIntegrationsDeps {
  projectContext: ProjectContext;
  integrationsStore: IIntegrationsStore;
  manageSettings: ManageSettingsUseCase;
  settingsRepository: ISettingsRepository;
  paperRepository: IPaperRepository;
  manageTags: ManageTagsUseCase;
  addPaper: AddPaperUseCase;
  projectBibliographyCollection: IProjectBibliographyCollectionStore;
  config?: IntegrationConfig;
}

// --- wire-integrations ---
export interface WiredIntegrations {
  registry: IntegrationsRegistry;
  config: IntegrationConfig;
  bibliographyMetadataSource?: IMetadataSource;
  projectBibliographyCollection: IProjectBibliographyCollectionStore;
}

/** Composition-root helper: resolve providers from manifest registry + env. */
export function wireIntegrations(deps: WireIntegrationsDeps): WiredIntegrations {
  const config = deps.config ?? readIntegrationConfig();
  const registry = getAppConfig().integrationManifests;

  let bibliographyMetadataSource: IMetadataSource | undefined;
  let projectBibliographyCollection = deps.projectBibliographyCollection;

  let bibliography: IntegrationsRegistry["bibliography"];
  if (config.bibliography === "none") {
    bibliography = new NoopBibliographyIntegration();
    projectBibliographyCollection = new NoopProjectBibliographyCollectionStore();
  } else {
    const manifest = findBibliographyManifest(registry, config.bibliography);
    if (!manifest) {
      bibliography = new NoopBibliographyIntegration();
      projectBibliographyCollection = new NoopProjectBibliographyCollectionStore();
    } else {
      const wired = manifest.wire(deps);
      bibliography = wired.integration;
      bibliographyMetadataSource = wired.metadataSource;
      projectBibliographyCollection = wired.projectCollection;
    }
  }

  let notifications: IntegrationsRegistry["notifications"];
  if (config.notifications === "none") {
    notifications = new NoopNotificationIntegration();
  } else {
    const manifest = findNotificationManifest(registry, config.notifications);
    notifications = manifest?.wire(deps) ?? new NoopNotificationIntegration();
  }

  let logSync: IntegrationsRegistry["logSync"];
  if (config.logSync === "none") {
    logSync = new NoopLogSyncIntegration();
  } else {
    const manifest = findLogSyncManifest(registry, config.logSync);
    logSync = manifest?.wire(deps) ?? new NoopLogSyncIntegration();
  }

  const gitRead =
    config.gitRead.length === 0
      ? new NoopGitClient()
      : (registry.gitRead.find((m) => config.gitRead.includes(m.id))?.wire() ?? new NoopGitClient());

  return {
    config,
    registry: { bibliography, notifications, logSync, gitRead },
    bibliographyMetadataSource,
    projectBibliographyCollection,
  };
}
