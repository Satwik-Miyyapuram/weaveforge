/**
 * Tables the browser may reach on the org server (PostgREST). This is the set that
 * db/migrations/0165_drop_personal_tables.sql keeps live (its "Kept live" header), plus the
 * share and integration reads it keeps for 1.0.x (user_settings, overleaf_*, milestones, projects).
 * Personal tables 0165 archives are not listed. Shared with the desktop read-only db guard,
 * so keep this the single source.
 */
export const ORG_SERVER_READ_TABLES = [
  "experiments",
  "experiment_metric_points",
  "experiment_metric_chunks",
  "experiment_metric_names",
  "lab_snapshots",
  "crdt_updates",
  "crdt_snapshots",
  "profiles",
  "organizations",
  "org_memberships",
  "org_invite_codes",
  "shares",
  "share_links",
  "share_link_rate_limits",
  "blob_objects",
  "shared_docs",
  "api_tokens",
  "sdk_inbox",
  "release_notices",
  "project_keys",
  "sync_tables",
  "sync_tombstones",
  "user_settings",
  "overleaf_connections",
  "overleaf_linked_reports",
  "overleaf_workshop_sessions",
  "milestones",
  "projects",
  "comments",
] as const;

/**
 * Org-server tables a read-only desktop may write (the share and org rows). Every other read-list
 * table, including personal ones it keeps live (projects, user_settings, milestones, experiments),
 * refuses insert, update, upsert and delete through readOnlyDb.
 */
export const ORG_SERVER_WRITE_TABLES = [
  "organizations",
  "org_memberships",
  "shares",
  "share_links",
  "comments",
  "blob_objects",
  "crdt_updates",
  "profiles",
] as const;

export const ORG_SERVER_RPCS = [
  "create_organization_atomic",
  "resolve_share_link",
  "redeem_share_link",
  "record_blob_access",
  "set_comment_resolved",
] as const;

/**
 * Storage buckets whose bytes may be written to the org server while the desktop is
 * read-only: shared blobs only. A personal image bucket (paper, log, report, vault)
 * stays off this list, so its bytes never leave the folder.
 */
export const ORG_SERVER_BUCKETS: readonly string[] = [];

export type OrgServerReadTable = (typeof ORG_SERVER_READ_TABLES)[number];
export type OrgServerWriteTable = (typeof ORG_SERVER_WRITE_TABLES)[number];
export type OrgServerRpc = (typeof ORG_SERVER_RPCS)[number];
