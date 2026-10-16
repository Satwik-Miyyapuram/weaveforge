-- Security-definer RPCs must not be callable by anonymous clients unless the
-- function is explicitly part of a public flow. Public share-link resolution
-- remains the one intentional anonymous exception.

revoke execute on function public.app_role(uuid) from anon;
revoke execute on function public.blob_shared_to_me(text, text) from anon;
revoke execute on function public.can_access(uuid) from anon;
revoke execute on function public.can_comment_resource(text, uuid) from anon;
revoke execute on function public.can_edit_resource(text, uuid) from anon;
revoke execute on function public.can_view_resource(text, uuid) from anon;
revoke execute on function public.check_share_link_rate(text, integer, interval) from anon;
revoke execute on function public.complete_org_setup() from anon;
revoke execute on function public.delete_user_account_data(uuid) from anon;
revoke execute on function public.get_public_keys(uuid[]) from anon;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.is_org_member(uuid, uuid) from anon;
revoke execute on function public.lab_root(uuid) from anon;
revoke execute on function public.leave_org(uuid) from anon;
revoke execute on function public.redeem_share_link(bytea) from anon;
revoke execute on function public.resolve_api_token(bytea) from anon;
revoke execute on function public.resolve_mcp_relay_token(bytea) from anon;
revoke execute on function public.resource_owner(text, uuid) from anon;
revoke execute on function public.shared_to_me_can_comment(text, uuid) from anon;
revoke execute on function public.shared_to_me_can_edit(text, uuid) from anon;
revoke execute on function public.shared_to_me(text, uuid) from anon;
revoke execute on function public.shared_to_user(text, uuid, uuid) from anon;
revoke execute on function public.shares_org_with(uuid, uuid) from anon;
revoke execute on function public.switch_active_org(uuid) from anon;

-- Keep trigger/helper functions deterministic against caller-controlled search
-- paths. These functions already exist in earlier migrations.
alter function public.set_updated_at() set search_path = public;
alter function public.parse_crdt_topic(text) set search_path = public;
