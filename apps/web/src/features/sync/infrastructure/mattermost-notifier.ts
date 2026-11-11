import type { CitationCandidate, LogEntry, Milestone, Paper } from "@weaveforge/core";
import type { Integration } from "../domain/parts";
import { readyCore } from "@/lib/rust-core";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { emitMattermostSignedOut } from "./mattermost-session";

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
