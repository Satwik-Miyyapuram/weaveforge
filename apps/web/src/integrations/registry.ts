import type {
  IBibliographyIntegration,
  ILogSyncIntegration,
  INotificationIntegration,
} from "@thesis/core";
import type { IGitClient } from "@/features/sync/domain/sync-ports";

/** Swappable third-party integrations wired at the composition root. */
export interface IntegrationsRegistry {
  bibliography: IBibliographyIntegration;
  notifications: INotificationIntegration;
  logSync: ILogSyncIntegration;
  gitRead: IGitClient;
}
