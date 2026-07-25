import { MattermostNotifier } from "@/features/sync/infrastructure/mattermost-notifier";
import { MattermostNotificationIntegration } from "../providers/mattermost/notification-integration";
import type { WireIntegrationsDeps } from "../wire-integrations";
import type { NotificationIntegrationManifest } from "./types";

const MATTERMOST_FIELDS = [
  { key: "token" as const, label: "Bot token", type: "password" as const, placeholder: "bot access token" },
  { key: "repo" as const, label: "Server URL", type: "text" as const, placeholder: "https://mattermost.example.com" },
  { key: "branch" as const, label: "Channel ID", type: "text" as const, placeholder: "e.g. 8soyabwthjnf9qgemvw…" },
];

export const mattermostNotificationManifest: NotificationIntegrationManifest = {
  id: "mattermost",
  kind: "notification",
  projectDescriptors: [
    {
      id: "mattermost-notify",
      provider: "mattermost",
      title: "Mattermost — project alerts",
      description: "Post milestone updates and new-citation alerts to a channel.",
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
      notifier: new MattermostNotifier(),
    });
  },
};
