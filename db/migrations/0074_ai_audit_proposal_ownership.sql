-- An audit record must belong to the same user as its referenced proposal.
-- RLS already isolates rows; this additionally prevents cross-owner references
-- when an attacker knows a proposal UUID.
drop policy if exists "ai_audit_records_owner_insert" on ai_audit_records;

create policy "ai_audit_records_owner_insert" on ai_audit_records
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from ai_proposals proposal
      where proposal.id = proposal_id
        and proposal.user_id = (select auth.uid())
    )
  );
