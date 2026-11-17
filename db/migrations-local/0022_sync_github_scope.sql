-- Whether the last pull ran with GitHub connected.
--
-- While GitHub is connected the pull skips workspace rows and the watermark
-- moves past them. When GitHub is disconnected, the watermark must rewind to 0
-- so those skipped rows are read again. This flag says the watermark was last
-- moved under the GitHub scope, so the rewind happens only when it is needed.
alter table sync_state add column if not exists github_scope boolean not null default false;
