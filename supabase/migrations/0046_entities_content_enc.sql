-- Phase 7 slice: content_enc columns for logbook + report (plan §5.2).

alter table log_entries
  add column if not exists content_enc text,
  add column if not exists enc_epoch int;

alter table report_sections
  add column if not exists content_enc text,
  add column if not exists enc_epoch int;

alter table papers
  add column if not exists content_enc text,
  add column if not exists enc_epoch int,
  add column if not exists doi_bidx text,
  add column if not exists arxiv_bidx text;

create unique index if not exists papers_user_doi_bidx_uniq
  on papers (user_id, doi_bidx) where doi_bidx is not null;

create unique index if not exists papers_user_arxiv_bidx_uniq
  on papers (user_id, arxiv_bidx) where arxiv_bidx is not null;

alter table experiments
  add column if not exists content_enc text,
  add column if not exists enc_epoch int;

alter table milestones
  add column if not exists content_enc text,
  add column if not exists enc_epoch int;

alter table comments
  add column if not exists content_enc text,
  add column if not exists enc_epoch int;
