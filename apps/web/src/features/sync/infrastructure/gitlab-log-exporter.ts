import type { LogEntry } from "@weaveforge/core";
import type { Integration } from "../domain/integration";
import { readyCore } from "@/lib/rust-core";

/**
 * Pushes a log entry to GitLab as markdown `logbook/<date>-<id>.md` directly
 * from the unlocked browser. One file per entry (id-suffixed to avoid clashes).
 * The file URL, path, markdown and commit messages come from the Rust core.
 */
export class GitLabLogExporter {
  constructor(private readonly fetchFn: typeof fetch = (...a) => fetch(...a)) {}

  async push(integration: Integration, entry: LogEntry): Promise<void> {
    if (!readyCore().gitConnectionReady(integration)) return;
    const plan = planFor(integration, entry);
    const headers = { "Content-Type": "application/json", "PRIVATE-TOKEN": plan.token };
    const body = JSON.stringify({
      branch: plan.branch,
      content: plan.content,
      commit_message: plan.commitMessage,
    });
    let res = await this.fetchFn(plan.fileUrl, {
      method: "PUT",
      headers,
      body,
    });
    if (res.status === 400 || res.status === 404) {
      res = await this.fetchFn(plan.fileUrl, {
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
    if (!readyCore().gitConnectionReady(integration)) return;
    const plan = planFor(integration, entry);
    const res = await this.fetchFn(plan.fileUrl, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "PRIVATE-TOKEN": plan.token },
      body: JSON.stringify({
        branch: plan.branch,
        commit_message: plan.deleteCommitMessage,
      }),
    });
    if (!res.ok) {
      const d = await res.text().catch(() => "");
      throw new Error(`GitLab delete failed (${res.status}). ${d}`.trim());
    }
  }
}

/** The connection of the integration, with the Rust-planned file writes for one entry. */
function planFor(integration: Integration, entry: LogEntry) {
  const { token, repo, branch } = readyCore().gitConnection(integration);
  const plan = readyCore().gitlabLogFilePlan({
    repo,
    branch,
    entryDate: entry.entryDate,
    id: entry.id,
    kind: entry.kind,
    body: entry.body,
  });
  return {
    token,
    fileUrl: plan.fileUrl,
    branch: plan.branch,
    content: plan.content,
    commitMessage: plan.commitMessage,
    deleteCommitMessage: plan.deleteCommitMessage,
  };
}
