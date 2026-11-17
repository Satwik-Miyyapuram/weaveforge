/**
 * The secrets the page may name. Mirrored in `apps/shell/src/secrets.rs`
 * (`PAGE_WRITABLE`), which also keeps `local-api-token` for the shell alone, and lets the page
 * write but never read back `overleaf-token` or `git-sync-token`. The workspace names are kept
 * per open workspace and need one to be open.
 */
export type DesktopSecretName =
  | "ai-provider"
  | "overleaf-token"
  | "git-sync-token"
  | "zotero-api-key"
  | "mattermost-token"
  | "repo-link-token";
