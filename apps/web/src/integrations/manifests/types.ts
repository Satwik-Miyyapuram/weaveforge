import type {
  IBibliographyIntegration,
  ICitationSource,
  ILogSyncIntegration,
  IMetadataSource,
  INotificationIntegration,
  IProjectBibliographyCollectionStore,
  UserIntegrationDescriptor,
} from "@weaveforge/core";
import type { IGitClient } from "@/features/sync/domain/sync-ports";
import type { WireIntegrationsDeps } from "../wire-integrations";
import type { WireCitationsDeps } from "../wire-citations";
import type { ProjectSyncDescriptor } from "../descriptors-types";

type IntegrationManifestKind =
  | "bibliography"
  | "citation"
  | "notification"
  | "logSync"
  | "gitRead";

interface IntegrationManifestBase {
  readonly id: string;
  readonly kind: IntegrationManifestKind;
}

export interface BibliographyIntegrationManifest extends IntegrationManifestBase {
  readonly kind: "bibliography";
  readonly userDescriptor: UserIntegrationDescriptor;
  readonly wire: (deps: WireIntegrationsDeps) => {
    integration: IBibliographyIntegration;
    metadataSource?: IMetadataSource;
    projectCollection: IProjectBibliographyCollectionStore;
  };
}

export interface CitationIntegrationManifest extends IntegrationManifestBase {
  readonly kind: "citation";
  readonly userDescriptor: UserIntegrationDescriptor;
  readonly wire: (deps: WireCitationsDeps) => ICitationSource[];
}

export interface NotificationIntegrationManifest extends IntegrationManifestBase {
  readonly kind: "notification";
  readonly projectDescriptors: readonly ProjectSyncDescriptor[];
  readonly wire: (deps: WireIntegrationsDeps) => INotificationIntegration;
}

export interface LogSyncIntegrationManifest extends IntegrationManifestBase {
  readonly kind: "logSync";
  readonly projectDescriptors: readonly ProjectSyncDescriptor[];
  readonly wire: (deps: WireIntegrationsDeps) => ILogSyncIntegration;
}

export interface GitReadIntegrationManifest extends IntegrationManifestBase {
  readonly kind: "gitRead";
  readonly projectDescriptors: readonly ProjectSyncDescriptor[];
  /** Multi-select — returns shared GitClient when any git-read host is enabled. */
  readonly wire: () => IGitClient;
}

export type IntegrationManifest =
  | BibliographyIntegrationManifest
  | CitationIntegrationManifest
  | NotificationIntegrationManifest
  | LogSyncIntegrationManifest
  | GitReadIntegrationManifest;

export interface IntegrationManifestRegistry {
  readonly bibliography: readonly BibliographyIntegrationManifest[];
  readonly citation: readonly CitationIntegrationManifest[];
  readonly notification: readonly NotificationIntegrationManifest[];
  readonly logSync: readonly LogSyncIntegrationManifest[];
  readonly gitRead: readonly GitReadIntegrationManifest[];
  readonly all: readonly IntegrationManifest[];
}

export function buildManifestRegistry(manifests: readonly IntegrationManifest[]): IntegrationManifestRegistry {
  const bibliography = manifests.filter((m): m is BibliographyIntegrationManifest => m.kind === "bibliography");
  const citation = manifests.filter((m): m is CitationIntegrationManifest => m.kind === "citation");
  const notification = manifests.filter((m): m is NotificationIntegrationManifest => m.kind === "notification");
  const logSync = manifests.filter((m): m is LogSyncIntegrationManifest => m.kind === "logSync");
  const gitRead = manifests.filter((m): m is GitReadIntegrationManifest => m.kind === "gitRead");
  return { bibliography, citation, notification, logSync, gitRead, all: manifests };
}

export function findBibliographyManifest(
  registry: IntegrationManifestRegistry,
  id: string,
): BibliographyIntegrationManifest | undefined {
  return registry.bibliography.find((m) => m.id === id);
}

export function findCitationManifest(
  registry: IntegrationManifestRegistry,
  id: string,
): CitationIntegrationManifest | undefined {
  return registry.citation.find((m) => m.id === id);
}

export function findNotificationManifest(
  registry: IntegrationManifestRegistry,
  id: string,
): NotificationIntegrationManifest | undefined {
  return registry.notification.find((m) => m.id === id);
}

export function findLogSyncManifest(
  registry: IntegrationManifestRegistry,
  id: string,
): LogSyncIntegrationManifest | undefined {
  return registry.logSync.find((m) => m.id === id);
}
