export { readIntegrationConfig, integrationConfigFromEnv } from "./config";
export type {
  BibliographyProviderId,
  CitationProviderId,
  GitReadProviderId,
  IntegrationConfig,
  LogSyncProviderId,
  NotificationProviderId,
} from "./config";
export type { IntegrationsRegistry } from "./registry";
export { wireIntegrations } from "./wire-integrations";
export type { WireIntegrationsDeps, WiredIntegrations } from "./wire-integrations";
export { wireCitationSources } from "./wire-citations";
export { BUILTIN_INTEGRATION_MANIFESTS } from "./manifests/builtin";
export type { IntegrationManifest, IntegrationManifestRegistry } from "./manifests/types";
export { applyBibliographyAnnotations } from "./providers/zotero/bibliography-integration";
