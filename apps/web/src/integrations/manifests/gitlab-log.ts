import type { IIntegrationsStore } from "@/features/sync/domain/sync-ports";
import { GitLabLogExporter } from "@/features/sync/infrastructure/gitlab-log-exporter";
import type { ILogSyncIntegration, LogEntry } from "@weaveforge/core";
import type { WireIntegrationsDeps } from "../wire-integrations";
import type { LogSyncIntegrationManifest } from "./types";

// --- log-sync-integration ---
export class GitLabLogSyncIntegration implements ILogSyncIntegration {
  readonly providerId = "gitlab";
  private readonly exporter: GitLabLogExporter;

  constructor(
    private readonly deps: {
      projectId: () => string | null;
      integrations: IIntegrationsStore;
      exporter?: GitLabLogExporter;
    },
  ) {
    this.exporter = deps.exporter ?? new GitLabLogExporter();
  }

  async pushLog(entry: LogEntry): Promise<void> {
    const pid = this.deps.projectId();
    if (!pid) return;
    await this.exporter.push(await this.deps.integrations.get(pid, "gitlab"), entry);
  }

  async removeLog(entry: LogEntry): Promise<void> {
    const pid = this.deps.projectId();
    if (!pid) return;
    await this.exporter.remove(await this.deps.integrations.get(pid, "gitlab"), entry);
  }
}

// --- gitlab-log ---
const GITLAB_FIELDS = [
  { key: "token" as const, label: "Token", type: "password" as const, placeholder: "glpat-… (api scope)" },
  { key: "repo" as const, label: "Repo", type: "text" as const, placeholder: "group/project (or numeric id)" },
  { key: "branch" as const, label: "Branch", type: "text" as const, placeholder: "main" },
];

export const gitlabLogSyncManifest: LogSyncIntegrationManifest = {
  id: "gitlab",
  kind: "logSync",
  projectDescriptors: [
    {
      id: "gitlab-log-sync",
      provider: "gitlab",
      title: "GitLab — logbook",
      description: "Push each log entry as markdown to a repo.",
      color: "#e2503f",
      fields: GITLAB_FIELDS,
      runtimeGate: { kind: "logSync", providerId: "gitlab" },
    },
  ],
  wire(deps: WireIntegrationsDeps) {
    const projectId = () => deps.projectContext.projectId;
    return new GitLabLogSyncIntegration({
      projectId,
      integrations: deps.integrationsStore,
      exporter: new GitLabLogExporter(),
    });
  },
};
