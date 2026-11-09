import type { IntegrationConfig, EnvReader } from "./config";
import type { IntegrationManifestRegistry } from "./manifests/types";
import { getAppConfig } from "@/deployment/app-config";
import { readyCore } from "@/lib/rust-core";

/** Provider choice (defaults, `none`, unknown ids) is resolved in the Rust core (`integrations::config`). */
function integrationConfigFromEnv(
  env: EnvReader,
  registry: IntegrationManifestRegistry = getAppConfig().integrationManifests,
): IntegrationConfig {
  return readyCore().resolveIntegrationConfig(
    {
      bibliographyProvider: env.NEXT_PUBLIC_BIBLIOGRAPHY_PROVIDER,
      notificationProvider: env.NEXT_PUBLIC_NOTIFICATION_PROVIDER,
      logSyncProvider: env.NEXT_PUBLIC_LOG_SYNC_PROVIDER,
      citationProvider: env.NEXT_PUBLIC_CITATION_PROVIDER,
      gitReadProviders: env.NEXT_PUBLIC_GIT_READ_PROVIDERS,
    },
    {
      bibliography: registry.bibliography.map((m) => m.id),
      notification: registry.notification.map((m) => m.id),
      logSync: registry.logSync.map((m) => m.id),
      citation: registry.citation.map((m) => m.id),
      gitRead: registry.gitRead.map((m) => m.id),
    },
  );
}

/** Read provider selection from env + manifest registry (composition root only). */
export function readIntegrationConfig(env?: EnvReader): IntegrationConfig {
  const registry = getAppConfig().integrationManifests;
  if (env) return integrationConfigFromEnv(env, registry);
  return integrationConfigFromEnv(
    {
      NEXT_PUBLIC_BIBLIOGRAPHY_PROVIDER: process.env.NEXT_PUBLIC_BIBLIOGRAPHY_PROVIDER,
      NEXT_PUBLIC_NOTIFICATION_PROVIDER: process.env.NEXT_PUBLIC_NOTIFICATION_PROVIDER,
      NEXT_PUBLIC_LOG_SYNC_PROVIDER: process.env.NEXT_PUBLIC_LOG_SYNC_PROVIDER,
      NEXT_PUBLIC_CITATION_PROVIDER: process.env.NEXT_PUBLIC_CITATION_PROVIDER,
      NEXT_PUBLIC_GIT_READ_PROVIDERS: process.env.NEXT_PUBLIC_GIT_READ_PROVIDERS,
    },
    registry,
  );
}
