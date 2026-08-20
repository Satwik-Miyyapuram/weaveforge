import type { GitBranch, GitCommit } from "../infrastructure/git-client";
import type { Integration, SyncProvider } from "./integration";

export interface IIntegrationsStore {
  get(projectId: string, provider: SyncProvider): Promise<Integration>;
  save(projectId: string, integration: Integration): Promise<void>;
}

export interface IGitClient {
  listCommits(integration: Integration, branch?: string): Promise<GitCommit[]>;
  listBranches(integration: Integration): Promise<GitBranch[]>;
}
