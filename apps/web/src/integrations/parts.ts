import { getAppConfig } from "@/deployment/app-config";
import type { IGitClient, Integration, SyncProvider } from "@/features/sync/domain/parts";
import { typedCore } from "@/lib/rust-core";
import type {
  IBibliographyIntegration,
  ICitationSource,
  ILogSyncIntegration,
  INotificationIntegration,
  ManageSettingsUseCase,
} from "@weaveforge/core";
import { type IntegrationConfig, readIntegrationConfig } from "./config";
import { findCitationManifest } from "./manifests/types";

// --- credentials ---
/** Async credential reader for integration adapters (DIP). */
export type IntegrationCredentialReader = (
  providerId: string,
  fieldId: string,
) => Promise<string | undefined>;

export function createCredentialReader(
  manageSettings: ManageSettingsUseCase,
): IntegrationCredentialReader {
  return async (providerId, fieldId) => {
    const settings = await manageSettings.get();
    return typedCore().getUserIntegrationField(settings, providerId, fieldId);
  };
}

// --- descriptors-types ---
/** Maps UI labels to {@link Integration} storage keys (`token` / `repo` / `branch`). */
interface ProjectSyncFieldDescriptor {
  readonly key: keyof Pick<Integration, "token" | "repo" | "branch">;
  readonly label: string;
  readonly type: "text" | "password";
  readonly placeholder: string;
}

export interface ProjectSyncDescriptor {
  readonly id: string;
  readonly provider: SyncProvider;
  readonly title: string;
  readonly description: string;
  readonly color: string;
  readonly fields: readonly ProjectSyncFieldDescriptor[];
  readonly runtimeGate: {
    readonly kind: "notifications" | "logSync" | "gitRead";
    readonly providerId: string;
  };
}

// --- registry ---
/** Swappable third-party integrations wired at the composition root. */
export interface IntegrationsRegistry {
  bibliography: IBibliographyIntegration;
  notifications: INotificationIntegration;
  logSync: ILogSyncIntegration;
  gitRead: IGitClient;
}

// --- wire-citations ---
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
