/**
 * Tables and RPCs the browser may reach on the org server (PostgREST): organisations, sharing and
 * comments. Personal data never goes here; it lives in the workspace folder. Sync names are not
 * listed: 0.9.8 drops server sync. Shared with the desktop read-only db guard, so keep this the single source.
 */
export const ORG_SERVER_TABLES = [
  "organizations",
  "org_memberships",
  "share_links",
  "comments",
  "blob_objects",
] as const;

export const ORG_SERVER_RPCS = [
  "create_organization_atomic",
  "resolve_share_link",
  "redeem_share_link",
  "record_blob_access",
  "set_comment_resolved",
] as const;

export type OrgServerTable = (typeof ORG_SERVER_TABLES)[number];
export type OrgServerRpc = (typeof ORG_SERVER_RPCS)[number];
