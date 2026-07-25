import { GitLabLogExporter } from "@/features/sync/infrastructure/gitlab-log-exporter";
import { GitLabLogSyncIntegration } from "../providers/gitlab/log-sync-integration";
import type { WireIntegrationsDeps } from "../wire-integrations";
import type { LogSyncIntegrationManifest } from "./types";

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
