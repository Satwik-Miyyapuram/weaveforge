import type { ICitationSource } from "@weaveforge/core";
import { getAppConfig } from "@/deployment/app-config";
import { readIntegrationConfig, type IntegrationConfig } from "./config";
import { findCitationManifest } from "./manifests/types";
import type { ManageSettingsUseCase } from "@weaveforge/core";

export interface WireCitationsDeps {
  manageSettings: ManageSettingsUseCase;
  config?: IntegrationConfig;
}

/** Pick citation sources from manifest registry + deployment config. */
export function wireCitationSources(deps: WireCitationsDeps): ICitationSource[] {
  const config = deps.config ?? readIntegrationConfig();
  if (config.citation === "none") return [];

  const manifest = findCitationManifest(getAppConfig().integrationManifests, config.citation);
  return manifest?.wire(deps) ?? [];
}
