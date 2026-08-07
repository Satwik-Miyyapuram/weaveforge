import type { LogEntry, Milestone } from "@weaveforge/core";
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

export interface IGitLabLogExporter {
  push(integration: Integration, entry: LogEntry): Promise<void>;
  remove(integration: Integration, entry: LogEntry): Promise<void>;
}

export interface IMattermostNotifier {
  post(integration: Integration, message: string): Promise<void>;
}

export interface IMilestoneNotifier {
  notify(event: "added" | "status", milestone: Milestone): Promise<void>;
}
