/**
 * Integration provider selection and runtime gates (Rust `integrations`),
 * re-exported from index.ts.
 */
import {
  gitlabCombinedActive as rawGitlabCombinedActive,
  projectGateOpen as rawProjectGateOpen,
  resolveIntegrationConfig as rawResolveIntegrationConfig,
  userGateOpen as rawUserGateOpen,
} from "../pkg/wf_wasm.js";
import type { IntegrationConfig, IntegrationEnv, ProviderIds, RuntimeGate } from "./bindings.js";

/** Generated types; `ResolvedIntegrationConfig` is the Rust `IntegrationConfig`. */
export type { IntegrationEnv, ProviderIds, RuntimeGate } from "./bindings.js";
export type { IntegrationConfig as ResolvedIntegrationConfig } from "./bindings.js";

/** Resolve the integration config from env and the registered ids. */
export function resolveIntegrationConfig(
  env: IntegrationEnv,
  ids: ProviderIds,
): IntegrationConfig {
  return rawResolveIntegrationConfig(env, ids) as IntegrationConfig;
}

/** Whether a user-scope descriptor shows. No gate means open. */
export function userGateOpen(
  config: Omit<IntegrationConfig, "gitRead"> & { gitRead: readonly string[] },
  gate: RuntimeGate | undefined,
): boolean {
  return rawUserGateOpen(config, gate ?? null) as boolean;
}

/** Whether a project-scope descriptor shows. */
export function projectGateOpen(config: Omit<IntegrationConfig, "gitRead"> & { gitRead: readonly string[] }, gate: RuntimeGate): boolean {
  return rawProjectGateOpen(config, gate) as boolean;
}

/** True when GitLab is both git-read and log-sync (the two descriptors merge). */
export function gitlabCombinedActive(config: Omit<IntegrationConfig, "gitRead"> & { gitRead: readonly string[] }): boolean {
  return rawGitlabCombinedActive(config) as boolean;
}
