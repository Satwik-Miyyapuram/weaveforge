import type { IntegrationConfig, EnvReader } from "./config";
import type { IntegrationManifestRegistry } from "./manifests/types";
import { getAppConfig } from "@/deployment/app-config";

const DEFAULTS = {
  bibliography: "zotero",
  notifications: "mattermost",
  logSync: "gitlab",
  citation: "semantic-scholar",
  gitRead: ["github", "gitlab"] as const,
} as const;

function pickProvider(
  value: string | undefined,
  allowed: readonly string[],
  fallback: string,
): string {
  const safeFallback = allowed.includes(fallback) ? fallback : allowed[0] ?? "none";
  if (!value?.trim()) return safeFallback;
  if (value === "none") return "none";
  return allowed.includes(value) ? value : safeFallback;
}

function parseGitReadList(
  raw: string | undefined,
  allowed: readonly string[],
  fallback: readonly string[],
): string[] {
  const safeFallback = fallback.filter((id) => allowed.includes(id));
  if (!raw?.trim()) return safeFallback;
  if (raw.trim().toLowerCase() === "none") return [];
  const picked = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => allowed.includes(s));
  return picked.length ? picked : safeFallback;
}

export function integrationConfigFromEnv(
  env: EnvReader,
  registry: IntegrationManifestRegistry = getAppConfig().integrationManifests,
): IntegrationConfig {
  const bibIds = registry.bibliography.map((m) => m.id);
  const notifIds = registry.notification.map((m) => m.id);
  const logIds = registry.logSync.map((m) => m.id);
  const citIds = registry.citation.map((m) => m.id);
  const gitIds = registry.gitRead.map((m) => m.id);

  return {
    bibliography: pickProvider(env.NEXT_PUBLIC_BIBLIOGRAPHY_PROVIDER, bibIds, DEFAULTS.bibliography),
    notifications: pickProvider(env.NEXT_PUBLIC_NOTIFICATION_PROVIDER, notifIds, DEFAULTS.notifications),
    logSync: pickProvider(env.NEXT_PUBLIC_LOG_SYNC_PROVIDER, logIds, DEFAULTS.logSync),
    citation: pickProvider(env.NEXT_PUBLIC_CITATION_PROVIDER, citIds, DEFAULTS.citation),
    gitRead: parseGitReadList(env.NEXT_PUBLIC_GIT_READ_PROVIDERS, gitIds, DEFAULTS.gitRead),
  };
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
