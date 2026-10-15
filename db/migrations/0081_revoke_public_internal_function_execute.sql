-- Remove PostgreSQL's default PUBLIC EXECUTE grant from internal security
-- definer functions. Role-specific grants are managed by the application
-- migrations; the public share-link resolver is intentionally excluded.

REVOKE EXECUTE ON FUNCTION public.app_role(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.blob_shared_to_me(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_access(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_comment_resource(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_edit_resource(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_view_resource(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_share_link_rate(text, integer, interval) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_org_setup() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_user_account_data(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_public_keys(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lab_root(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.leave_org(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.redeem_share_link(bytea) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_api_token(bytea) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_mcp_relay_token(bytea) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resource_owner(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.shared_to_me(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.shared_to_me_can_comment(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.shared_to_me_can_edit(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.shared_to_user(text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.shares_org_with(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.switch_active_org(uuid) FROM PUBLIC;
