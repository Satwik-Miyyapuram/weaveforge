import type { ThesisTrackerConfig, ThesisTrackerPlugin } from "@thesis/core";
import type { IntegrationManifest } from "@/integrations/manifests/types";
import { GENERATED_BUILTIN_INTEGRATION_MANIFESTS } from "@/deployment/generated-registry";
import { buildManifestRegistry, type IntegrationManifestRegistry } from "@/integrations/manifests/types";
import userConfig from "../../../../thesis-tracker.config";

/** Web deploy plugin — may ship integration wire manifests or feature modules. */
export interface WebThesisTrackerPlugin extends ThesisTrackerPlugin {
  readonly integrationManifests?: readonly IntegrationManifest[];
}

export interface ResolvedAppConfig {
  readonly plugins: readonly WebThesisTrackerPlugin[];
  readonly integrationManifests: IntegrationManifestRegistry;
  readonly pluginModules: readonly import("@thesis/core").FeatureModule[];
  /** Undefined means all built-in feature modules are enabled. */
  readonly enabledBuiltinFeatureIds?: readonly string[];
}

function asWebPlugins(config: ThesisTrackerConfig): WebThesisTrackerPlugin[] {
  return (config.plugins ?? []) as WebThesisTrackerPlugin[];
}

export function resolveAppConfig(
  config: ThesisTrackerConfig = userConfig,
): ResolvedAppConfig {
  const plugins = asWebPlugins(config);
  const extraManifests = plugins.flatMap((p) => p.integrationManifests ?? []);
  const integrationAllowlist = config.builtins?.integrations;
  const builtinManifests = integrationAllowlist
    ? GENERATED_BUILTIN_INTEGRATION_MANIFESTS.filter((manifest) => integrationAllowlist.includes(manifest.id))
    : GENERATED_BUILTIN_INTEGRATION_MANIFESTS;
  const allManifests = [...builtinManifests, ...extraManifests];
  const pluginModules = plugins.flatMap((p) => p.modules ?? []);
  return {
    plugins,
    integrationManifests: buildManifestRegistry(allManifests),
    pluginModules,
    enabledBuiltinFeatureIds: config.builtins?.features,
  };
}

let cached: ResolvedAppConfig | null = null;

export function getAppConfig(): ResolvedAppConfig {
  if (!cached) cached = resolveAppConfig();
  return cached;
}

/** @internal test helper */
export function resetAppConfigCache(): void {
  cached = null;
}
