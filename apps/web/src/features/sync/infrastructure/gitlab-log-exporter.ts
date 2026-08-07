import type { LogEntry } from "@weaveforge/core";
import type { Integration } from "../domain/integration";
import { gitConnection, gitConnectionReady } from "../domain/integration-fields";

/**
 * Pushes a log entry to GitLab as markdown `logbook/<date>-<id>.md` directly
 * from the unlocked browser. One file per entry (id-suffixed to avoid clashes).
 */
export class GitLabLogExporter {
  constructor(private readonly fetchFn: typeof fetch = (...a) => fetch(...a)) {}

  async push(integration: Integration, entry: LogEntry): Promise<void> {
    if (!gitConnectionReady(integration)) return;
    const { token, repo, branch } = gitConnection(integration);
    const url = gitLabFileUrl(repo, logPath(entry));
    const headers = { "Content-Type": "application/json", "PRIVATE-TOKEN": token };
    const body = JSON.stringify({
      branch: branch || "main",
      content: toMarkdown(entry),
      commit_message: `log: ${entry.entryDate}`,
    });
    let res = await this.fetchFn(url, {
      method: "PUT",
      headers,
      body,
    });
    if (res.status === 400 || res.status === 404) {
      res = await this.fetchFn(url, {
        method: "POST",
        headers,
        body,
      });
    }
    if (!res.ok) {
      const d = await res.text().catch(() => "");
      throw new Error(`GitLab sync failed (${res.status}). ${d}`.trim());
    }
  }

  /** Remove a log entry's file from GitLab. A missing file is not an error. */
  async remove(integration: Integration, entry: LogEntry): Promise<void> {
    if (!gitConnectionReady(integration)) return;
    const { token, repo, branch } = gitConnection(integration);
    const res = await this.fetchFn(gitLabFileUrl(repo, logPath(entry)), {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "PRIVATE-TOKEN": token },
      body: JSON.stringify({
        branch: branch || "main",
        commit_message: `log: delete ${entry.entryDate}`,
      }),
    });
    if (!res.ok) {
      const d = await res.text().catch(() => "");
      throw new Error(`GitLab delete failed (${res.status}). ${d}`.trim());
    }
  }
}

function gitLabFileUrl(repo: string, path: string): string {
  return `https://gitlab.com/api/v4/projects/${encodeURIComponent(repo)}/repository/files/${encodeURIComponent(path)}`;
}

/** One file per entry, id-suffixed to avoid same-day clashes. */
function logPath(e: LogEntry): string {
  return `logbook/${e.entryDate}-${e.id.slice(0, 8)}.md`;
}

function toMarkdown(e: LogEntry): string {
  const meta = [
    `date: ${e.entryDate}`,
    `kind: ${e.kind}`,
  ].filter(Boolean).join("\n");
  return `---\n${meta}\n---\n\n${e.body}\n`;
}
