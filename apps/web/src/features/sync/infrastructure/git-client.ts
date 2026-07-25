import type { Integration } from "../domain/integration";
import { gitConnection } from "../domain/integration-fields";

/** Normalized git types so the UI doesn't care which provider it came from. */
export interface GitCommit {
  sha: string;
  shortSha: string;
  message: string;
  author?: string;
  date?: string;
  url?: string;
}
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
      ? (data as GhCommit[]).map(ghCommit)
      : (data as GlCommit[]).map(glCommit);
  }

  async listBranches(i: Integration): Promise<GitBranch[]> {
    const data = await this.get(i, "branches");
    return (data as { name: string }[]).map((b) => ({ name: b.name }));
  }

  private async get(i: Integration, kind: string, branch?: string): Promise<unknown> {
    const { token, repo, branch: defaultBranch } = gitConnection(i);
    if (!token || !repo) throw new Error("Connect this provider in Settings first.");
    const selectedBranch = branch ?? defaultBranch ?? "main";
    const url = i.provider === "github"
      ? kind === "branches"
        ? `https://api.github.com/repos/${repo}/branches?per_page=100`
        : `https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(selectedBranch)}&per_page=30`
      : kind === "branches"
        ? `https://gitlab.com/api/v4/projects/${encodeURIComponent(repo)}/repository/branches?per_page=100`
        : `https://gitlab.com/api/v4/projects/${encodeURIComponent(repo)}/repository/commits?ref_name=${encodeURIComponent(selectedBranch)}&per_page=30`;
    const headers: Record<string, string> = i.provider === "github"
      ? { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }
      : { "PRIVATE-TOKEN": token };
    const res = await this.fetchFn(url, { headers });
    if (!res.ok) {
      const d = await res.text().catch(() => "");
      throw new Error(`Git read failed (${res.status}). ${d}`.trim());
    }
    return res.json();
  }
}

interface GhCommit { sha: string; commit: { message: string; author?: { name?: string; date?: string } }; html_url?: string }
interface GlCommit { id: string; message: string; author_name?: string; created_at?: string; web_url?: string }

function ghCommit(c: GhCommit): GitCommit {
  return {
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    message: c.commit.message.split("\n")[0] ?? "",
    author: c.commit.author?.name,
    date: c.commit.author?.date,
    url: c.html_url,
  };
}
function glCommit(c: GlCommit): GitCommit {
  return {
    sha: c.id,
    shortSha: c.id.slice(0, 7),
    message: c.message.split("\n")[0] ?? "",
    author: c.author_name,
    date: c.created_at,
    url: c.web_url,
  };
}

/** Build a web URL to a commit from a repo URL + sha (best-effort by host). */
export function commitUrl(repoUrl?: string, sha?: string): string | undefined {
  if (!repoUrl || !sha) return undefined;
  const base = repoUrl.replace(/\.git$/, "").replace(/\/$/, "");
  if (base.includes("gitlab")) return `${base}/-/commit/${sha}`;
  return `${base}/commit/${sha}`; // GitHub + most others
}
