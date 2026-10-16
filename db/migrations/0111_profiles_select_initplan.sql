-- Speed up the `profiles` SELECT policy.
--
-- Measured against the live database, a directory read of `profiles` took
-- ~1.8s while every other query on a screen load took ~220ms. It is the
-- slowest thing the app does, and five screens await one before rendering.
--
-- Cause: the policy's last predicate is
--
--     lab_root(user_id) = lab_root((select auth.uid()))
--
-- `lab_root` is a recursive CTE over `profiles`. The right-hand side is
-- constant for the whole query, but written this way Postgres re-evaluates it
-- for every candidate row, so a directory scan runs the recursion twice per
-- row instead of once per row plus once per query.
--
-- Wrapping it in a scalar subquery makes it an InitPlan, evaluated once. This
-- is the same trick migration 0085 applied to `auth.uid()`; it was not applied
-- to the surrounding function call.
--
-- `lab_root(user_id)` stays per-row: it genuinely depends on the row. Removing
-- that would mean denormalising the lab root onto `profiles` and keeping it
-- current with a trigger — a bigger change than this one, and worth measuring
-- after this lands rather than assuming.
--
-- Behaviour is unchanged. The predicate is logically identical; only when the
-- constant half is computed changes.
--
-- Authored for human review per roadmap decision D4 — DO NOT apply
-- automatically. A human applies this after review.

DROP POLICY IF EXISTS "profiles_select_access" ON public.profiles;
CREATE POLICY "profiles_select_access" ON public.profiles
  FOR SELECT USING (
    user_id = (select auth.uid())
    OR can_access(user_id)
    OR shares_org_with((select auth.uid()), user_id)
    OR lab_root(user_id) = (select lab_root((select auth.uid())))
  );

-- `lab_root` walks `profiles.supervisor_id` upwards on every call. Without an
-- index that walk is a sequential scan per recursion step.
CREATE INDEX IF NOT EXISTS profiles_supervisor_id_idx
  ON public.profiles (supervisor_id);

COMMENT ON POLICY "profiles_select_access" ON public.profiles IS
  'Self, shared, org-peer, or same-lab. The lab_root comparison keeps its constant half in a scalar subquery so it is evaluated once per query, not once per row.';
