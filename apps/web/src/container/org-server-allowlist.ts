/**
 * Tables the browser may reach on the org server (PostgREST). This is the set that
 * db/migrations/0165_drop_personal_tables.sql keeps live (its "Kept live" header), less the
 * personal tables 0.9.8 no longer reads (projects, experiments, milestones, user_settings,
 * overleaf_*): files are the source of truth. Personal tables 0165 archives are not listed.
 * The shared-with-me read of an owner's rows goes through its own guard (shared-read-guard.ts).
 * Keep this the single source.
 */
export const ORG_SERVER_READ_TABLES = [
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
  "comments",
] as const;

/**
 * Org-server tables a read-only desktop may write (the share and org rows). Every other read-list
 * table refuses insert, update, upsert and delete through readOnlyDb.
 */
export const ORG_SERVER_WRITE_TABLES = [
  "organizations",
  "org_memberships",
  "shares",
  "share_links",
  "comments",
  "blob_objects",
  // crdt_updates: insert only, and only live-share types (read-only-repositories.ts guardCrdtUpdates).
  "crdt_updates",
  "profiles",
  // A member's published lab snapshot: shared with the lab on purpose, like a share.
  "lab_snapshots",
] as const;

export const ORG_SERVER_RPCS = [
  "create_organization_atomic",
  "resolve_share_link",
  "redeem_share_link",
  "record_blob_access",
  "set_comment_resolved",
  // Live-share crdt compaction; limitCrdtUpdateStore and readOnlyDb refuse it for every other type.
  "compact_crdt_log",
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
