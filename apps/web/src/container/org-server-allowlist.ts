/**
 * Tables and RPCs the browser may reach on the org server (PostgREST): organisations, sharing,
 * comments and sync relay. Personal data never goes here; it lives in the workspace folder.
 * Shared with the desktop read-only db guard, so keep this the single source.
 */
export const ORG_SERVER_TABLES = [
  "organizations",
  "org_memberships",
  "project_shares",
  "share_links",
  "shared_items",
  "comments",
  "blob_objects",
  "sync_changes",
  "sync_state",
  "sync_seq",
  "sync_outbox",
  "sync_conflicts",
  "sync_pull_held",
  "sync_backfill",
  "sync_shared_rows",
  "sync_writable_columns",
] as const;

export const ORG_SERVER_RPCS = [
  "create_organization_atomic",
  "resolve_share_link",
  "redeem_share_link",
  "record_blob_access",
  "set_comment_resolved",
  "sync_changes",
] as const;

export type OrgServerTable = (typeof ORG_SERVER_TABLES)[number];
export type OrgServerRpc = (typeof ORG_SERVER_RPCS)[number];
