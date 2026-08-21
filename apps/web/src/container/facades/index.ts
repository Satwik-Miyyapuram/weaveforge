/**
 * The container, and the facades it is made of.
 *
 * One file per feature rather than one file of 1,600 lines: every facade here
 * is independent — none references another, and each is used only by the
 * `AppContainer` below — so the single file was a filing decision, not a
 * design one. This barrel keeps `@/container/facades` resolving as it did.
 */

export * from "./papers";
export * from "./graph";
export * from "./plan";
export * from "./logbook";
export * from "./report";
export * from "./collab";
export * from "./vault";
export * from "./experiments";
export * from "./dashboard";
export * from "./settings";
export * from "./ai-assistant";
export * from "./org";
export * from "./sharing";
export * from "./projects";
export * from "./auth";
export * from "./sync";
export * from "./reading-lists";
export * from "./workspace";

import type { IntegrationsRegistry } from "@/integrations/registry";
import type { PrefetchProjectUseCase } from "@/application/prefetch-project.use-case";
import type { PapersFacade } from "./papers";
import type { GraphFacade } from "./graph";
import type { PlanFacade } from "./plan";
import type { LogbookFacade } from "./logbook";
import type { ReportFacade } from "./report";
import type { CollabFacade } from "./collab";
import type { VaultFacade } from "./vault";
import type { ExperimentsFacade } from "./experiments";
import type { DashboardFacade } from "./dashboard";
import type { SettingsFacade } from "./settings";
import type { AiAssistantFacade, AiProposalFacade } from "./ai-assistant";
import type { OrgFacade } from "./org";
import type { SharingFacade } from "./sharing";
import type { ProjectsFacade } from "./projects";
import type { AuthFacade } from "./auth";
import type { SyncFacade } from "./sync";
import type { ReadingListsFacade } from "./reading-lists";
import type { WorkspaceFacade } from "./workspace";

/** Swappable third-party integrations wired at the composition root. */

export interface AppContainer {
  integrations: IntegrationsRegistry;
  papers: PapersFacade;
  graph: GraphFacade;
  plan: PlanFacade;
  logbook: LogbookFacade;
  report: ReportFacade;
  vault: VaultFacade;
  experiments: ExperimentsFacade;
  dashboard: DashboardFacade;
  settings: SettingsFacade;
  aiAssistant: AiAssistantFacade;
  aiProposals: AiProposalFacade;
  org: OrgFacade;
  sharing: SharingFacade;
  projects: ProjectsFacade;
  auth: AuthFacade;
  collab: CollabFacade;
  sync: SyncFacade;
  readingLists: ReadingListsFacade;
  workspace: WorkspaceFacade;
  search: import("@/features/search/application/workspace-search").WorkspaceSearch;
  prefetchProject: PrefetchProjectUseCase;
  /** Active integration providers for this deployment (env-driven). */
  integrationConfig: import("@/integrations/config").IntegrationConfig;
  backendConfig: import("@/backend/config").BackendConfig;
}
