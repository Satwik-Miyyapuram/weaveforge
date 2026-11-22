-- Synthetic 0.9.4 local database rows for the migrate_097 tests (L1). Ink bucket is vault-assets.
--
-- Every row belongs to the local user (00000000-0000-4000-8000-000000000001)
-- unless noted. No real data, no real secrets. Edge cases:
--   * two papers share a title (slug collision, idsuffix rule)
--   * paper p3 has no pdf (missing file is created, not skipped)
--   * orphan annotation pin (key matches no annotation)
--   * comment thread with a reply, anchor and a resolved root
--   * a share row (shares are NOT exported)
--   * unicode incl. U+2028 and a quoted apostrophe
--   * blobs in two buckets (paper-images, ink)

-- Project
insert into projects (id, user_id, name, color) values
  ('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000001', 'Thesis', '#336699');

-- Papers
insert into papers (id, user_id, project_id, title, authors, year, venue, doi, arxiv_id, url, pdf_path, abstract, status, rating, read_at, bibtex, metadata, created_at, updated_at, tags) values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100',
   'Attention Is All You Need', '{"Vaswani et al."}', 2017, 'NeurIPS', '10.5555/example1', null, 'https://example.org/p1', 'papers/pdf/attention.pdf',
   'Transformers.', 'reading', 5, '2026-10-01', null, '{}', '2026-10-01T10:00:00Z', '2026-10-02T10:00:00Z', '{"ml","nlp"}'),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100',
   'Duplicate Title', '{"A. Author"}', 2020, null, null, null, null, null,
   null, 'to_read', null, null, null, '{}', '2026-10-03T10:00:00Z', '2026-10-03T10:00:00Z', '{}'),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100',
   'Duplicate Title', '{"B. Author"}', 2021, null, null, null, null, null,
   null, 'to_read', null, null, null, '{}', '2026-10-04T10:00:00Z', '2026-10-04T10:00:00Z', '{}'),
  ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100',
   'Café “quoted” line' || chr(8232) || 'sep O''Brien', '{"Ünïcode"}', 2024, null, null, null, null, null,
   'Abstract with ✓ and unicode.', 'reading', null, null, null, '{}', '2026-10-05T10:00:00Z', '2026-10-05T10:00:00Z', '{}');

-- Tags and paper tags
insert into tags (id, user_id, project_id, name, color, created_at) values
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100', 'ml', '#ff0000', '2026-10-01T10:00:00Z'),
  ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100', 'nlp', null, '2026-10-01T10:00:00Z');

insert into paper_tags (paper_id, tag_id, source, annotation_ref) values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000401', 'manual', null),
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000402', 'annotation', 'a1');

-- Paper fields
insert into paper_field_defs (id, user_id, project_id, name, kind, options, sort_order) values
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100', 'Venue kind', 'select', '["conf","journal"]', 1);

insert into paper_field_values (id, user_id, project_id, paper_id, field_id, value) values
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100',
   '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000501', '"conf"');

-- Paper relations
insert into paper_relations (id, user_id, project_id, from_paper, to_paper, relation, note, source, created_at) values
  ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100',
   '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000202', 'cites', 'see §3', 'manual', '2026-10-06T10:00:00Z');

-- Reading lists and items
insert into reading_lists (id, user_id, project_id, name, description, parent_id, sort_order, color, created_at) values
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100', 'To read', null, null, 1, null, '2026-10-01T10:00:00Z'),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100', 'Screened', null, null, 2, '#00ff00', '2026-10-01T10:00:00Z');

insert into reading_list_items (id, list_id, paper_id, sort_order, note) values
  ('00000000-0000-4000-8000-000000000311', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', 1, 'first'),
  ('00000000-0000-4000-8000-000000000312', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000202', 2, null),
  ('00000000-0000-4000-8000-000000000313', '00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000203', 1, null);

insert into screening_decisions (id, item_id, reviewer_id, stage, state, reason, decided_at) values
  ('00000000-0000-4000-8000-000000000321', '00000000-0000-4000-8000-000000000313', '00000000-0000-4000-8000-000000000001',
   'title_abstract', 'included', 'relevant', '2026-10-07T10:00:00Z');

-- Library pins (paper pins only are exported)
insert into library_pins (id, user_id, project_id, resource_type, resource_id, owner_id, created_at) values
  ('00000000-0000-4000-8000-000000000D01', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100',
   'paper', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', '2026-10-08T10:00:00Z');

-- Log entries, milestones, experiments, report sections
insert into log_entries (id, user_id, project_id, entry_date, kind, body, links, created_at) values
  ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100',
   '2026-11-01', 'daily', 'Started [[Attention]] review', '[]', '2026-11-01T10:00:00Z');

insert into milestones (id, user_id, project_id, title, description, status, target_date, dependencies, compute, created_at) values
  ('00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100',
   'Draft chapter 2', 'Chapter two draft', 'planned', '2026-12-01', '[]', '[]', '2026-11-01T10:00:00Z');

insert into experiments (id, user_id, project_id, name, hypothesis, status, repo_url, commit_sha, branch, run_command, config, metrics, artifacts, result_note, started_at, finished_at, related_paper, created_at) values
  ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100',
   'Run A', 'Warmup helps', 'done', null, null, 'main', 'python run.py', '{"lr":0.001}', '{}', '[]', 'ok',
   '2026-11-02T10:00:00Z', '2026-11-02T11:00:00Z', '00000000-0000-4000-8000-000000000201', '2026-11-02T10:00:00Z');

insert into report_sections (id, user_id, project_id, title, section_no, parent_id, status, word_count, target_words, deadline, draft_url, notes, sort_order, created_at) values
  ('00000000-0000-4000-8000-000000000A01', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100',
   'Introduction', '1', null, 'drafting', 120, 1000, null, null, 'needs cites', 1, '2026-11-03T10:00:00Z');

-- Reader annotations
insert into reader_annotations (id, user_id, project_id, paper_id, origin, zotero_key, type, color, text, comment, tags, anchor, page_index, sort_index, zotero_version, sync_state, created_at, updated_at) values
  ('00000000-0000-4000-8000-000000000B01', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100',
   '00000000-0000-4000-8000-000000000201', 'local', null, 'highlight', 'yellow', 'Attention is all you need', 'key claim', '{"ml"}', '{"page":1}', 1, '00001', null, 'synced',
   '2026-10-09T10:00:00Z', '2026-10-09T10:00:00Z'),
  ('00000000-0000-4000-8000-000000000B02', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100',
   '00000000-0000-4000-8000-000000000204', 'local', null, 'note', '#ffd400', 'Ünï ' || chr(8232) || ' text', '', '{}', '{"page":2}', 2, '00002', null, 'synced',
   '2026-10-10T10:00:00Z', '2026-10-10T10:00:00Z');

-- Annotation pins: first pins a real annotation section, second is orphan (no such annotation key)
insert into annotation_pins (id, user_id, project_id, paper_id, annotation_key, report_section_id, created_at) values
  ('00000000-0000-4000-8000-000000000C01', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100',
   '00000000-0000-4000-8000-000000000201', '00001', '00000000-0000-4000-8000-000000000A01', '2026-10-11T10:00:00Z'),
  ('00000000-0000-4000-8000-000000000C02', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100',
   '00000000-0000-4000-8000-000000000202', 'orphan-key', '00000000-0000-4000-8000-000000000A01', '2026-10-12T10:00:00Z');

-- Comments: root (resolved, anchored) with one reply
insert into comments (id, author_id, resource_type, resource_id, body, created_at, anchor_quote, anchor_prefix, anchor_suffix, parent_id, resolved_at) values
  ('00000000-0000-4000-8000-000000000E01', '00000000-0000-4000-8000-000000000001', 'paper', '00000000-0000-4000-8000-000000000201',
   'Check this claim', '2026-10-13T10:00:00Z', 'all you need', 'Attention is ', ' transformers', null, '2026-10-14T10:00:00Z'),
  ('00000000-0000-4000-8000-000000000E02', '00000000-0000-4000-8000-000000000001', 'paper', '00000000-0000-4000-8000-000000000201',
   'Reply: checked ✓', '2026-10-13T11:00:00Z', null, null, null, '00000000-0000-4000-8000-000000000E01', null);

-- Shares (not exported: the server owns sharing). The recipient needs an auth.users row (FK).
insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000F99', 'recipient@fixture.invalid') on conflict (id) do nothing;
insert into shares (id, owner_id, recipient_id, resource_type, resource_id, access, created_at) values
  ('00000000-0000-4000-8000-000000000F01', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000F99',
   'paper', '00000000-0000-4000-8000-000000000201', 'view', '2026-10-15T10:00:00Z');

-- User settings (placeholder values only)
insert into user_settings (user_id, zotero_api_key, zotero_library, semantic_scholar_key, updated_at) values
  ('00000000-0000-4000-8000-000000000001', 'FIXTURE-PLACEHOLDER', 'users/0', null, '2026-10-16T10:00:00Z');

-- AI proposals (content is opaque ciphertext placeholder)
insert into ai_proposals (id, user_id, project_id, kind, status, resource_type, resource_id, expected_revision, content, created_at, updated_at) values
  ('00000000-0000-4000-8000-000000001101', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100',
   'note', 'pending', 'paper', '00000000-0000-4000-8000-000000000201', 'rev1', '{"synthetic":true}'::jsonb, '2026-10-17T10:00:00Z', '2026-10-17T10:00:00Z');

-- Vault page (scratch note body)
insert into vault_pages (id, user_id, project_id, parent_id, title, body, sort_order, created_at, updated_at) values
  ('00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100', null,
   'Scratch', 'Body with unicode ✓ and ' || chr(8232) || ' separator', 1, '2026-10-18T10:00:00Z', '2026-10-18T10:00:00Z');

-- A second note with no ink, to show ink is copied for every note, not only opened ones.
insert into vault_pages (id, user_id, project_id, parent_id, title, body, sort_order, created_at, updated_at) values
  ('00000000-0000-4000-8000-000000001002', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100', null,
   'Plain note', 'No ink here', 2, '2026-10-18T11:00:00Z', '2026-10-18T11:00:00Z');

-- Experiment metric points: two series on one run (names are a shared dictionary).
insert into experiment_metric_names (name) values ('loss'), ('acc') on conflict (name) do nothing;
insert into experiment_metric_points (experiment_id, user_id, value, wall_time, metric_id, step) values
  ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000001', 0.5, '2026-11-02T10:05:00Z',
   (select id from experiment_metric_names where name = 'loss'), 1),
  ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000001', 0.4, '2026-11-02T10:06:00Z',
   (select id from experiment_metric_names where name = 'loss'), 2),
  ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000001', 0.9, '2026-11-02T10:06:00Z',
   (select id from experiment_metric_names where name = 'acc'), 1);

-- Local blobs. Paper images live in bucket paper-images. Ink chunks live in bucket vault-assets at
-- <user>/<note id>/ink/<ulid>.inkb (crates/wf-core/src/ink/ink_paths.rs:149,175). Bytes are base64 text.
insert into public.local_blobs (bucket, path, content_type, bytes, updated_at) values
  ('paper-images', 'p1/fig1.webp', 'image/webp', 'UklGRg==', '2026-10-19T10:00:00Z'),
  ('vault-assets', '00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000001001/ink/01HZ0000000000000000000000.inkb',
   'application/octet-stream', 'aW5r', '2026-10-19T10:00:00Z');

-- Second project: papers and notes must not leak across projects.
insert into projects (id, user_id, name, color) values
  ('00000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-000000000001', 'Side project', null);
insert into vault_pages (id, user_id, project_id, parent_id, title, body, sort_order, created_at, updated_at) values
  ('00000000-0000-4000-8000-000000001101', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000110', null,
   'Side note', 'Second project body.', 0, '2026-10-20T10:00:00Z', '2026-10-20T10:00:00Z');

-- Metric chunk (0115 rollup): one chunk of the loss series, parallel arrays of equal length.
insert into experiment_metric_chunks (experiment_id, user_id, metric_id, chunk_no, steps, values, wall_times) values
  ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000001',
   (select id from experiment_metric_names where name = 'loss'), 1,
   array[1, 2], array[0.5, 0.4], array['2026-11-02T10:05:00Z'::timestamptz, '2026-11-02T10:06:00Z'::timestamptz]);

-- Local secrets (0007): one row for the user. Synthetic reference only, no secret values.
insert into public.local_secrets (user_id, secrets, updated_at) values
  ('00000000-0000-4000-8000-000000000001', '{"synthetic":"keychain-ref"}'::jsonb, '2026-10-21T10:00:00Z');

-- Outbox (0001): one pending edit. Conflict (0004): one unresolved collision on a page title.
insert into sync_outbox (table_name, row_id, op, payload, base_version, created_at) values
  ('vault_pages', '00000000-0000-4000-8000-000000001001', 'update', '{"title":"Scratch"}'::jsonb, 1, '2026-10-22T10:00:00Z');
insert into sync_conflicts (table_name, row_id, base, local, remote, fields, server_version, created_at) values
  ('vault_pages', '00000000-0000-4000-8000-000000001002', '{"title":"Plain note"}'::jsonb,
   '{"title":"Plain note (local)"}'::jsonb, '{"title":"Plain note (remote)"}'::jsonb, '["title"]'::jsonb, 2,
   '2026-10-23T10:00:00Z');
