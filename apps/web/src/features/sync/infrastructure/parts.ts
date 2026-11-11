import { desktop } from "@/lib/desktop/desktop-bridge";
import { readyCore } from "@/lib/rust-core";
import type { CitationCandidate, LogEntry, Milestone, Paper } from "@weaveforge/core";
import type { GhCommit, GitCommit, GlCommit } from "@weaveforge/wasm";
import { DEFAULT_GIT_BRANCH, type Integration } from "../domain/parts";

// --- git-client ---
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

// --- gitlab-log-exporter ---
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

// --- mattermost-session ---
/**
 * A one-shot signal that a Mattermost session token stopped working.
 *
 * Posts run in the background and swallow their errors, so a 401 there has no
 * call site that can show anything. The notifier emits here instead, and one
 * listener near the app root raises the shared "signed out" dialog. Kept as a
 * module event, not React state, because the emitter is plain infrastructure.
 */
export interface MattermostSignedOut {
  /** Server URL (the integration's `repo`), so the dialog can re-sign-in to it. */
  serverUrl: string;
}

type Listener = (detail: MattermostSignedOut) => void;

const listeners = new Set<Listener>();

export function onMattermostSignedOut(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitMattermostSignedOut(detail: MattermostSignedOut): void {
  for (const listener of listeners) listener(detail);
}

// --- mattermost-notifier ---
/**
 * Posts plan updates. In the desktop app the shell sends them, so the server
 * needs no CORS rule; in a browser the Mattermost admin must allow this
 * origin in AllowCorsFrom. There is no credential proxy.
 */
export class MattermostNotifier {
  constructor(private readonly fetchFn?: typeof fetch) {}

  /** `channel` overrides the connection's main channel (per-event routing). */
  async post(integration: Integration, message: string, channel?: string): Promise<void> {
    if (!readyCore().mattermostConnectionReady(integration)) return;
    const { botToken, serverUrl, channelId: mainChannel } = readyCore().mattermostConnection(integration);
    const plan = readyCore().mattermostPostPlan({ serverUrl, channel: channel ?? null, mainChannel });
    if (plan.origin === null) throw new Error(plan.error ?? "");
    const origin = plan.origin;
    const res = await this.send(origin, botToken, plan.channelId, message);
    const outcome = readyCore().mattermostPostResponsePlan({ status: res.status, body: res.body });
    // An expired or revoked session token reads as 401/403: tell the UI so it
    // can offer re-sign-in, then still throw for the caller's own handling.
    if (outcome.signedOut) emitMattermostSignedOut({ serverUrl: origin });
    if (outcome.error !== null) throw new Error(outcome.error);
  }

  private async send(origin: string, token: string, channelId: string, message: string) {
    const viaShell = this.fetchFn ? undefined : desktop()?.mattermostPost;
    if (viaShell) return viaShell({ serverUrl: origin, token, channelId, message });
    const res = await (this.fetchFn ?? fetch)(`${origin}/api/v4/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel_id: channelId, message }),
    });
    return { status: res.status, body: res.ok ? "" : await res.text().catch(() => "") };
  }
}

/** Channel message for a milestone event (add / status change). */
export function milestoneMessage(event: "added" | "status", m: Milestone): string {
  return readyCore().milestoneMessage({
    event,
    title: m.title,
    status: m.status,
    targetDate: m.targetDate ?? null,
    compute: m.compute.map((x) => ({
      resource: x.resource,
      count: x.count ?? null,
      hours: x.hours != null ? String(x.hours) : null,
    })),
    dependencyCount: m.dependencies.length,
  });
}

export function citationAlertMessage(tracked: Paper, citing: CitationCandidate[]): string {
  return readyCore().citationAlertMessage({
    trackedTitle: tracked.title,
    citing: citing.map((paper) => ({
      title: paper.title,
      url: paper.url ?? null,
      year: paper.year ?? null,
      citationsLabel:
        typeof paper.citationCount === "number" ? paper.citationCount.toLocaleString() : null,
    })),
  });
}

export function logEntryMessage(e: LogEntry): string {
  return readyCore().logEntryMessage({ kind: e.kind, entryDate: e.entryDate, body: e.body });
}
