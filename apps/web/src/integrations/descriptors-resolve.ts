import type { UserIntegrationDescriptor } from "@thesis/core";
import { getAppConfig } from "@/deployment/app-config";
import type { IntegrationConfig } from "./config";
import type { ProjectSyncDescriptor } from "./descriptors-types";

const GITLAB_MERGED_DESCRIPTOR: ProjectSyncDescriptor = {
  id: "gitlab-combined",
  provider: "gitlab",
  title: "GitLab — Git tab & logbook",
  description:
    "One connection: read commits/branches in the Git tab and push log entries as markdown to the same repo.",
  color: "#e2503f",
  fields: [
    { key: "token", label: "Token", type: "password", placeholder: "glpat-… (api scope)" },
    { key: "repo", label: "Repo", type: "text", placeholder: "group/project (or numeric id)" },
    { key: "branch", label: "Branch", type: "text", placeholder: "main" },
  ],
  runtimeGate: { kind: "gitRead", providerId: "gitlab" },
};

function userDescriptorsFromManifests(): UserIntegrationDescriptor[] {
  const { integrationManifests } = getAppConfig();
  const bib = integrationManifests.bibliography.map((m) => m.userDescriptor);
  const cit = integrationManifests.citation.map((m) => m.userDescriptor);
  return [...bib, ...cit];
}

function projectDescriptorsFromManifests(): ProjectSyncDescriptor[] {
  const { integrationManifests } = getAppConfig();
  return [
    ...integrationManifests.notification.flatMap((m) => m.projectDescriptors),
    ...integrationManifests.logSync.flatMap((m) => m.projectDescriptors),
    ...integrationManifests.gitRead.flatMap((m) => m.projectDescriptors),
  ];
}

function gateOpen(config: IntegrationConfig, gate: UserIntegrationDescriptor["runtimeGate"]): boolean {
  if (!gate) return true;
  if (gate.kind === "bibliography") return config.bibliography === gate.providerId;
  if (gate.kind === "citation") return config.citation === gate.providerId;
  return true;
}

function projectGateOpen(config: IntegrationConfig, gate: ProjectSyncDescriptor["runtimeGate"]): boolean {
  if (gate.kind === "notifications") return config.notifications === gate.providerId;
  if (gate.kind === "logSync") return config.logSync === gate.providerId;
  if (gate.kind === "gitRead") return config.gitRead.includes(gate.providerId);
  return true;
}

export function userIntegrationsForConfig(config: IntegrationConfig): UserIntegrationDescriptor[] {
  return userDescriptorsFromManifests().filter((d) => gateOpen(config, d.runtimeGate));
}

export function projectSyncDescriptorsForConfig(config: IntegrationConfig): ProjectSyncDescriptor[] {
  const visible = projectDescriptorsFromManifests().filter((d) => projectGateOpen(config, d.runtimeGate));
  const gitlabRead = config.gitRead.includes("gitlab");
  const gitlabLog = config.logSync === "gitlab";
  if (gitlabRead && gitlabLog) {
    return visible
      .filter((d) => d.id !== "gitlab-git-read" && d.id !== "gitlab-log-sync")
      .concat([GITLAB_MERGED_DESCRIPTOR]);
  }
  return visible;
}

export function sharedProviderHint(
  descriptor: ProjectSyncDescriptor,
  all: readonly ProjectSyncDescriptor[],
): string | undefined {
  const siblings = all.filter((d) => d.provider === descriptor.provider && d.id !== descriptor.id);
  if (siblings.length === 0) return undefined;
  return `Uses the same stored credentials as “${siblings[0]?.title}”.`;
}
