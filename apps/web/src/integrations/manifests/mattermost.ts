import type { IIntegrationsStore } from "@/features/sync/domain/parts";
import type { MattermostNotifier } from "@/features/sync/infrastructure/parts";
import type {
  CitationCandidate,
  INotificationIntegration,
  LogEntry,
  Milestone,
  Paper,
} from "@weaveforge/core";
import type { MattermostEvent } from "@weaveforge/wasm";
import type { WireIntegrationsDeps } from "../wire-integrations";
import type { NotificationIntegrationManifest } from "./types";

// --- notification-integration ---
type Notifier = typeof import("@/features/sync/infrastructure/parts");

/** Loaded on first post: the layout wires this integration, the notifier is not needed to paint. */
const loadNotifier = (): Promise<Notifier> => import("@/features/sync/infrastructure/parts");

export class MattermostNotificationIntegration implements INotificationIntegration {
  readonly providerId = "mattermost";

  constructor(
    private readonly deps: {
      projectId: () => string | null;
      integrations: IIntegrationsStore;
      notifier?: MattermostNotifier;
    },
  ) {}

  notifyMilestone(event: "added" | "status", milestone: Milestone): Promise<void> {
    return this.send(event === "added" ? "milestoneAdded" : "milestoneStatus", (m) =>
      m.milestoneMessage(event, milestone),
    );
  }

  notifyCitationAlert(trackedPaper: Paper, citingPapers: CitationCandidate[]): Promise<void> {
    return this.send("citationAlerts", (m) => m.citationAlertMessage(trackedPaper, citingPapers));
  }

  notifyLogEntry(entry: LogEntry): Promise<void> {
    return this.send(entry.kind === "weekly" ? "weeklyLogs" : "dailyLogs", (m) => m.logEntryMessage(entry));
  }

  /** Posts only when the project switched this event on; routes to its channel. */
  private async send(event: MattermostEvent, message: (m: Notifier) => string): Promise<void> {
    const pid = this.deps.projectId();
    if (!pid) return;
    const integration = await this.deps.integrations.get(pid, "mattermost");
    const { readyCore } = await import("@/lib/rust-core");
    const channel = readyCore().mattermostChannelFor(integration, event);
    if (!channel) return;
    const m = await loadNotifier();
    const notifier = this.deps.notifier ?? new m.MattermostNotifier();
    await notifier.post(integration, message(m), channel);
  }
}

// --- mattermost ---
const MATTERMOST_FIELDS = [
  { key: "token" as const, label: "Bot token", type: "password" as const, placeholder: "bot access token" },
  { key: "repo" as const, label: "Server URL", type: "text" as const, placeholder: "https://mattermost.example.com" },
  { key: "branch" as const, label: "Default channel ID", type: "text" as const, placeholder: "e.g. 8soyabwthjnf9qgemvw…" },
];

export const mattermostNotificationManifest: NotificationIntegrationManifest = {
  id: "mattermost",
  kind: "notification",
  projectDescriptors: [
    {
      id: "mattermost-notify",
      provider: "mattermost",
      title: "Mattermost — project alerts",
      description: "Post log entries, milestone updates and new-citation alerts. You choose which events post, and to which channel.",
      color: "#1e60ab",
      fields: MATTERMOST_FIELDS,
      runtimeGate: { kind: "notifications", providerId: "mattermost" },
    },
  ],
  wire(deps: WireIntegrationsDeps) {
    const projectId = () => deps.projectContext.projectId;
    return new MattermostNotificationIntegration({
      projectId,
      integrations: deps.integrationsStore,
    });
  },
};
