-- Lock down org RLS helper functions (same pattern as complete_org_setup in 0031).

revoke all on function shares_org_with(uuid, uuid) from public;
grant execute on function shares_org_with(uuid, uuid) to authenticated;

revoke all on function is_org_member(uuid, uuid) from public;
grant execute on function is_org_member(uuid, uuid) to authenticated;
