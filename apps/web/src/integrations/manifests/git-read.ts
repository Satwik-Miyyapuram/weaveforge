import { GitClient } from "@/features/sync/infrastructure/git-client";
import type { GitReadIntegrationManifest } from "./types";

const GITHUB_FIELDS = [
  { key: "token" as const, label: "Token", type: "password" as const, placeholder: "ghp_… (repo scope)" },
  { key: "repo" as const, label: "Repo", type: "text" as const, placeholder: "owner/thesis-experiments" },
  { key: "branch" as const, label: "Branch", type: "text" as const, placeholder: "main" },
];

const GITLAB_FIELDS = [
  { key: "token" as const, label: "Token", type: "password" as const, placeholder: "glpat-… (api scope)" },
  { key: "repo" as const, label: "Repo", type: "text" as const, placeholder: "group/project (or numeric id)" },
  { key: "branch" as const, label: "Branch", type: "text" as const, placeholder: "main" },
];

export const githubGitReadManifest: GitReadIntegrationManifest = {
  id: "github",
  kind: "gitRead",
  projectDescriptors: [
    {
      id: "github-git-read",
      provider: "github",
      title: "GitHub — code & experiments",
      description: "Read commits and branches in the Git tab to track experiments.",
      color: "#2c2a26",
      fields: GITHUB_FIELDS,
      runtimeGate: { kind: "gitRead", providerId: "github" },
    },
  ],
  wire: () => new GitClient(),
};

export const gitlabGitReadManifest: GitReadIntegrationManifest = {
  id: "gitlab",
  kind: "gitRead",
  projectDescriptors: [
    {
      id: "gitlab-git-read",
      provider: "gitlab",
      title: "GitLab — Git tab",
      description:
        "Read commits and branches in the Git tab (same repo credentials as logbook when both are enabled).",
      color: "#e2503f",
      fields: GITLAB_FIELDS,
      runtimeGate: { kind: "gitRead", providerId: "gitlab" },
    },
  ],
  wire: () => new GitClient(),
};
