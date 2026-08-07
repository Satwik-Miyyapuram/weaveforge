import type { IMetadataSource, IProjectBibliographyCollectionStore } from "@weaveforge/core";
import { getAppConfig } from "@/deployment/app-config";
import { readIntegrationConfig, type IntegrationConfig } from "./config";
import { NoopBibliographyIntegration } from "./noop/noop-bibliography-integration";
import { NoopNotificationIntegration } from "./noop/noop-notification-integration";
import { NoopLogSyncIntegration } from "./noop/noop-log-sync-integration";
import { NoopProjectBibliographyCollectionStore } from "./noop/noop-project-bibliography-collection-store";
import { NoopGitClient } from "./noop/noop-git-client";
import {
  findBibliographyManifest,
  findLogSyncManifest,
  findNotificationManifest,
} from "./manifests/types";
import type { IntegrationsRegistry } from "./registry";
import type { WireIntegrationsDeps } from "./wire-integrations-deps";

export type { WireIntegrationsDeps } from "./wire-integrations-deps";

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
