/** Active third-party provider ids — resolved from integration manifests + env. */
export type BibliographyProviderId = string;
export type NotificationProviderId = string;
export type LogSyncProviderId = string;
export type CitationProviderId = string;
export type GitReadProviderId = string;

export interface IntegrationConfig {
  bibliography: BibliographyProviderId;
  notifications: NotificationProviderId;
  logSync: LogSyncProviderId;
  citation: CitationProviderId;
  /** Git tab reads commits/branches from these hosts (project-scoped tokens). */
  gitRead: readonly GitReadProviderId[];
}

/** Env bag for tests and composition-root overrides (avoids full ProcessEnv in unit tests). */
export type EnvReader = Record<string, string | undefined>;

export { readIntegrationConfig, integrationConfigFromEnv } from "./config-resolver";
