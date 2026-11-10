import { DEFAULT_GIT_BRANCH, type Integration } from "../domain/integration";
import type { GhCommit, GitCommit, GlCommit } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";

/** Normalized git types so the UI doesn't care which provider it came from. */
export type { GitCommit };
export interface GitBranch {
  name: string;
}

/**
 * Read-side client that calls the provider directly from the unlocked browser.
 * A third-party token is never sent to WeaveForge.
 */
export class GitClient {
  constructor(private readonly fetchFn: typeof fetch = (...a) => fetch(...a)) {}

  async listCommits(i: Integration, branch?: string): Promise<GitCommit[]> {
    const data = await this.get(i, "commits", branch);
    return i.provider === "github"
      ? readyCore().githubCommits(data as GhCommit[])
      : readyCore().gitlabCommits(data as GlCommit[]);
  }

  async listBranches(i: Integration): Promise<GitBranch[]> {
    const data = await this.get(i, "branches");
    return (data as { name: string }[]).map((b) => ({ name: b.name }));
  }

  private async get(i: Integration, kind: "commits" | "branches", branch?: string): Promise<unknown> {
    const conn = readyCore().gitConnection(i);
    const token = conn.token ?? "";
    const plan = readyCore().gitReadPlan({
      host: i.provider === "github" ? "github" : "gitlab",
      kind,
      token,
      repo: conn.repo ?? "",
      branch: branch ?? null,
      defaultBranch: conn.branch ?? DEFAULT_GIT_BRANCH,
    });
    if (plan.url === null) throw new Error(plan.error ?? "");
    const headers: Record<string, string> = i.provider === "github"
      ? { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }
      : { "PRIVATE-TOKEN": token };
    const res = await this.fetchFn(plan.url, { headers });
    if (!res.ok) {
      const d = await res.text().catch(() => "");
      throw new Error(readyCore().gitReadFailureMessage(res.status, d));
    }
    return res.json();
  }
}
