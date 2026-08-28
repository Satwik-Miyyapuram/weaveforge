# Supabase advisor disposition

The linked project was checked after migrations `0077` through `0088`.

## Fixed findings

- `share_link_rate_limits` now has a primary key and RLS with no client-facing
  policy (`0078`).
- `org_invite_codes` is explicitly denied to client roles (`0078`).
- Missing foreign-key indexes, including Overleaf connection ownership, are
  covered by `0077` and `0080`.
- Internal security-definer functions no longer have anonymous execution via
  the default `PUBLIC` grant (`0079`, `0081`). The only remaining anonymous
  function is `resolve_share_link`, which is intentionally public so a holder
  of a share-link URL can redeem it.
- Mutable function search paths were fixed in `0079`.

## Remaining findings and decisions

- `auth_leaked_password_protection`: the linked hosted Supabase project
  rejected enabling Have I Been Pwned checks because the current plan is below
  Pro. The setting must be enabled after upgrading the hosted project, or
  configured by the operator in a self-hosted Auth/GoTrue deployment.
- `authenticated_security_definer_function_executable`: these functions are
  used by authenticated application RPCs or by RLS predicates. Removing their
  authenticated execution grant would break authorization and key-lookup
  paths. They remain narrowly scoped by their SQL checks and RLS policies.
- `auth_rls_initplan`: Phases 1 through 4 are addressed by `0082` through
  `0085` for core ownership, sharing, key-access, nested ownership,
  organization, crypto, and CRDT policies.
- `multiple_permissive_policies`: resolved by `0086` through `0088` using
  explicit mutation policies and merged owner/shared access predicates.
- `unused_index`: no longer reported by the current linked advisor run.

The latest linked advisor run reports 27 findings: no remaining init-plan,
multiple-permissive-policy, or unused-index warnings; 25 intentional
authenticated security-definer warnings; one intentional public share-link
warning; and one leaked-password-protection warning. The leaked-password
setting remains an operator/Supabase-plan configuration item rather than a
database migration.
