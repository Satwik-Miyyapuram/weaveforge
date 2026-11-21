-- Files are the source of truth from 0.9.4. Signed-in users may still read the
-- legacy tables (for the one-time import) but no longer write them.
--
-- Applied with the 0.9.4 release, not before: 0.9.2 clients still write these.
-- Order: turn SDK_INBOX=1 on in the relay first. With it off, SDK metrics are
-- written as the user (sdk_metrics.rs), and this migration revokes that write.
-- Idempotent: revoking an absent privilege is a no-op, and the record table
-- keeps the first run's rows (on conflict do nothing).
--
-- The direct grants actually held are recorded in legacy_write_grants_0163 before
-- they are revoked, to authenticated and to PUBLIC, so the rollback restores
-- exactly what this removed. Inherited privileges are not recorded (the live ACL
-- differs from the migration history: default privileges, and 0112 revoking
-- lab_snapshots update on purpose).
--
-- Still writable by signed-in users (deliberately kept): blob_objects,
-- overleaf_connections, ai_mcp_relay_requests, profiles, organizations,
-- org_memberships, api_tokens.
--
-- Security-definer RPCs that write a revoked table and stay executable by
-- signed-in users, each with a caller found by a regex scan of apps/, crates/
-- and the rest of the repo (a regex scan, so dynamic calls can be missed):
--   compact_crdt_log(text, uuid, bigint) writes crdt_updates. Called by
--     crates/wf-core/src/repos/crdt_updates.rs (user database).
--   set_comment_resolved(uuid, boolean) writes comments. Called by
--     crates/wf-core/src/repos/comments.rs (user database).
--   experiment_metric_name_id(text) inserts experiment_metric_names. No
--     production caller found; it is named as an app RPC by 0141 and used as the
--     user in apps/web/src/backend/test/privileged-rpc-grants.rls.integration.ts.
--     Kept until a decision: revoking it would change that test.

create table if not exists public.legacy_write_grants_0163 (
  grantee text not null,
  table_name text not null,
  privilege text not null,
  primary key (grantee, table_name, privilege)
);

revoke all on public.legacy_write_grants_0163 from public, anon, authenticated;

do $$
declare
  t text;
  g text;
  p text;
begin
  foreach t in array array[
    'projects', 'experiment_metric_names', 'papers', 'tags', 'paper_tags',
    'vault_pages', 'reading_lists', 'report_sections', 'reading_list_items',
    'screening_decisions', 'paper_relations', 'experiments',
    'experiment_metric_points', 'experiment_metric_chunks', 'milestones',
    'log_entries', 'paper_field_defs', 'paper_field_values', 'paper_locus_anchors',
    'reader_annotations', 'annotation_pins', 'annotation_quotation_types',
    'citation_alert_tracks', 'lab_snapshots', 'user_settings', 'library_pins',
    'comments', 'ai_proposals', 'ai_audit_records', 'project_integrations',
    'overleaf_linked_reports', 'overleaf_workshop_sessions', 'crdt_updates'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      foreach g in array array['authenticated', 'public']
      loop
        foreach p in array array['INSERT', 'UPDATE', 'DELETE']
        loop
          if exists (
            select 1
            from pg_class c, aclexplode(c.relacl) acl
            where c.oid = to_regclass('public.' || t)
              and acl.privilege_type = p
              and acl.grantee = case when g = 'public' then 0::oid
                                     else (select oid from pg_roles where rolname = g) end
          ) then
            insert into public.legacy_write_grants_0163 (grantee, table_name, privilege)
              values (g, t, p)
              on conflict do nothing;
          end if;
        end loop;
      end loop;
      execute format('revoke insert, update, delete on public.%I from public, authenticated', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
