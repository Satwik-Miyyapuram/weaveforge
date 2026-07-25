/** Public API of the sync feature module (web). */
export type { Integration, SyncProvider } from "./domain/integration";
export { emptyIntegration } from "./domain/integration";
export { SupabaseIntegrationsStore } from "./infrastructure/supabase-integrations-store";
export { GitClient, commitUrl } from "./infrastructure/git-client";
export type { GitCommit, GitBranch } from "./infrastructure/git-client";
export { GitLabLogExporter } from "./infrastructure/gitlab-log-exporter";
export { MattermostNotifier, milestoneMessage } from "./infrastructure/mattermost-notifier";
export { SyncSettings } from "./ui/sync-settings";
export { GitScreen } from "./ui/git-screen";
export { gitModule } from "./module";
