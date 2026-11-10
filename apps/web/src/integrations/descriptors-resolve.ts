import type { UserIntegrationDescriptor } from "@weaveforge/core";
import { getAppConfig } from "@/deployment/app-config";
import { readyCore } from "@/lib/rust-core";
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

/** Gate predicates live in the Rust core (`integrations::gates`). */
export function userIntegrationsForConfig(config: IntegrationConfig): UserIntegrationDescriptor[] {
  const core = readyCore();
  return userDescriptorsFromManifests().filter((d) => core.userGateOpen(config, d.runtimeGate));
}

export function projectSyncDescriptorsForConfig(config: IntegrationConfig): ProjectSyncDescriptor[] {
  const core = readyCore();
  const visible = projectDescriptorsFromManifests().filter((d) => core.projectGateOpen(config, d.runtimeGate));
  if (core.gitlabCombinedActive(config)) {
    return visible
      .filter((d) => d.id !== "gitlab-git-read" && d.id !== "gitlab-log-sync")
      .concat([GITLAB_MERGED_DESCRIPTOR]);
  }
  return visible;
}

/** The hint text lives in the Rust core (`integrations::shared_provider_hint`). */
export function sharedProviderHint(
  descriptor: ProjectSyncDescriptor,
  all: readonly ProjectSyncDescriptor[],
): string | undefined {
  return readyCore().sharedProviderHint(descriptor, all) ?? undefined;
}
