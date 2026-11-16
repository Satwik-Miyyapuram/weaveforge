-- Release notices shown in-app after each release. Rows are inserted by
-- scripts/publish-release-notice.mjs; users only read them. Dismissal is
-- stored per account in user_settings.last_release_notice_seen.

create table if not exists release_notices (
  id           uuid primary key default gen_random_uuid(),
  version      text not null unique,
  title        text not null,
  body         text not null default '',
  published_at timestamptz not null default now()
);

create index if not exists release_notices_published_idx on release_notices (published_at desc);

alter table release_notices enable row level security;

-- RLS only filters rows; the role also needs table privileges to use them.
grant select on release_notices to authenticated;

drop policy if exists "release_notices_read" on release_notices;
create policy "release_notices_read" on release_notices for select to authenticated using (true);

alter table user_settings
  add column if not exists last_release_notice_seen text;

comment on column release_notices.version is
  'Release version this notice belongs to (matches the CHANGELOG.md section heading); unique so a republish updates in place.';

comment on column user_settings.last_release_notice_seen is
  'Version of the latest release notice the user dismissed; a notice is shown while its version differs from this.';
