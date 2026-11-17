-- Shares this account owns, keyed by the share's id: a copy of the server's
-- shares table, which the local database does not keep.
--
-- While GitHub is connected only sharing and the rows that are shared are sent
-- to the server; the rest of the workspace stays in the git vault. Each cycle
-- sets this table from the server's list of the account's own shares, and a
-- grant or revoke on this device sets it at once. resource_id is null for a
-- type-wide share (every resource of that type).
create table if not exists sync_shared_rows (
  share_id uuid primary key,
  resource_type text not null,
  resource_id uuid
);

create index if not exists sync_shared_rows_resource
  on sync_shared_rows (resource_type, resource_id);
