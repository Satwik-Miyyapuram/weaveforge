-- Attachments written on a signed-in desktop before the server has them.
--
-- A picture put into a note or a PDF is kept in `local_blobs` at once, so it
-- shows with no network and no storage service. This is the queue that carries
-- it to the server afterwards: one row per path, the latest intent winning, so
-- a picture removed before it ever reached the server is never sent at all.
create table if not exists public.local_blob_uploads (
  bucket text not null,
  path text not null,
  op text not null check (op in ('upload', 'remove')),
  -- Bumped by every re-queue, so a send that raced a newer write leaves it queued.
  version integer not null default 1,
  attempts integer not null default 0,
  last_error text,
  queued_at timestamptz not null default now(),
  primary key (bucket, path)
);

create index if not exists local_blob_uploads_queued on public.local_blob_uploads (queued_at);
