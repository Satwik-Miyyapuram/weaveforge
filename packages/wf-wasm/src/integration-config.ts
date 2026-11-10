/**
 * Integration provider selection and runtime gates (Rust `integrations`),
 * re-exported from index.ts.
 */
import {
  userGateOpen as rawUserGateOpen,
} from "../pkg/wf_wasm.js";
import type {
  IntegrationConfig,
  IntegrationEnv,
  ProviderIds,
  RuntimeGate,
} from "./bindings.js";

export {
  gitlabCombinedActive,
  projectGateOpen,
} from "../pkg/wf_wasm.js";

export {
  resolveIntegrationConfig,
} from "../pkg/wf_wasm.js";

/** Generated types; `ResolvedIntegrationConfig` is the Rust `IntegrationConfig`. */
export type { IntegrationEnv, ProviderIds, RuntimeGate } from "./bindings.js";
export type { IntegrationConfig as ResolvedIntegrationConfig } from "./bindings.js";

/** Whether a user-scope descriptor shows. No gate means open. */
export function userGateOpen(
  config: Omit<IntegrationConfig, "gitRead"> & { gitRead: readonly string[] },
  gate: RuntimeGate | undefined,
): boolean {
  return rawUserGateOpen(config, gate ?? null) as boolean;
}

