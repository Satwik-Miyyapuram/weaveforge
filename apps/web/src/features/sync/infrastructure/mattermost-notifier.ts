import type { CitationCandidate, LogEntry, Milestone, Paper } from "@weaveforge/core";
import type { Integration } from "../domain/integration";
import { mattermostConnection, mattermostConnectionReady } from "../domain/integration-fields";
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
    if (!mattermostConnectionReady(integration)) return;
    const { botToken, serverUrl } = mattermostConnection(integration);
    const channelId = channel?.trim() || mattermostConnection(integration).channelId;
    let origin: string;
    try {
      const url = new URL(serverUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
      origin = url.origin;
    } catch {
      throw new Error("Mattermost server URL must be a valid http(s) URL.");
    }
    const res = await this.send(origin, botToken, channelId, message);
    if (res.status < 200 || res.status >= 300) {
      // An expired or revoked session token reads as 401/403: tell the UI so it
      // can offer re-sign-in, then still throw for the caller's own handling.
      if (res.status === 401 || res.status === 403) emitMattermostSignedOut({ serverUrl: origin });
      throw new Error(`Mattermost post failed (${res.status}). ${res.body}`.trim());
    }
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
  const head =
    event === "added"
      ? `:new: Milestone added: **${m.title}**`
      : `:arrows_counterclockwise: Milestone **${m.title}** → \`${m.status.replace("_", " ")}\``;
  const lines = [head];
  if (m.targetDate) lines.push(`Target: ${m.targetDate}`);
  if (m.compute.length > 0) {
    const c = m.compute
      .map((x) => [x.count, x.resource, x.hours != null ? `~${x.hours}h` : null].filter(Boolean).join(" "))
      .join(", ");
    lines.push(`Compute: ${c}`);
  }
  if (m.dependencies.length > 0) lines.push(`Depends on ${m.dependencies.length} item(s)`);
  return lines.join("\n");
}

export function citationAlertMessage(tracked: Paper, citing: CitationCandidate[]): string {
  const lines = [
    `:bell: **${citing.length} new citation${citing.length === 1 ? "" : "s"}** for **${tracked.title}**`,
  ];
  for (const paper of citing.slice(0, 10)) {
    const title = paper.url ? `[${paper.title}](${paper.url})` : paper.title;
    const year = paper.year ? ` (${paper.year})` : "";
    const cites =
      typeof paper.citationCount === "number"
        ? ` · ${paper.citationCount.toLocaleString()} citations`
        : "";
    lines.push(`- ${title}${year}${cites}`);
  }
  if (citing.length > 10) lines.push(`- …and ${citing.length - 10} more`);
  return lines.join("\n");
}

export function logEntryMessage(e: LogEntry): string {
  const head = e.kind === "weekly" ? `:spiral_calendar_pad: **Weekly log — ${e.entryDate}**` : `:memo: **Daily log — ${e.entryDate}**`;
  return `${head}
${e.body}`;
}
