/** Active third-party provider ids — resolved from integration manifests + env. */
export interface IntegrationConfig {
  bibliography: string;
  notifications: string;
  logSync: string;
  citation: string;
  /** Git tab reads commits/branches from these hosts (project-scoped tokens). */
  gitRead: readonly string[];
}

/** Env bag for tests and composition-root overrides (avoids full ProcessEnv in unit tests). */
export type EnvReader = Record<string, string | undefined>;

export { readIntegrationConfig } from "./config-resolver";
