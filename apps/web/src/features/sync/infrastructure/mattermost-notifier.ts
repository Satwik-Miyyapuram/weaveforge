import type { CitationCandidate, Milestone, Paper } from "@thesis/core";
import type { Integration } from "../domain/integration";
import { mattermostConnection, mattermostConnectionReady } from "../domain/integration-fields";

/**
 * Posts plan updates directly from the unlocked browser. The Mattermost admin
 * must allow this app's origin in AllowCorsFrom; there is no credential proxy.
 */
export class MattermostNotifier {
  constructor(private readonly fetchFn: typeof fetch = (...a) => fetch(...a)) {}

  async post(integration: Integration, message: string): Promise<void> {
    if (!mattermostConnectionReady(integration)) return;
    const { botToken, serverUrl, channelId } = mattermostConnection(integration);
    let origin: string;
    try {
      const url = new URL(serverUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
      origin = url.origin;
    } catch {
      throw new Error("Mattermost server URL must be a valid http(s) URL.");
    }
    const res = await this.fetchFn(`${origin}/api/v4/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${botToken}` },
      body: JSON.stringify({
        channel_id: channelId,
        message,
      }),
    });
    if (!res.ok) {
      const d = await res.text().catch(() => "");
      throw new Error(`Mattermost post failed (${res.status}). ${d}`.trim());
    }
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
