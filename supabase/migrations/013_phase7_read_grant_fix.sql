-- =====================================================================
-- Migration 013 — Phase 7 read-table SELECT grant fix
-- =====================================================================
-- BUG: /actuals and /variance fail for authenticated users with
--   "Could not find the table 'public.actuals_batches' in the schema cache".
--
-- ROOT CAUSE: Migration 010 enabled RLS on the Phase 7 read tables, created
-- tenant-scoped *_select_member policies, and REVOKEd INSERT/UPDATE/DELETE from
-- anon/authenticated — but it never issued the base `GRANT SELECT ... TO
-- authenticated`. An RLS policy only filters rows a role is *already* allowed to
-- read; without the underlying table-level SELECT grant the authenticated role
-- has no privilege at all, and PostgREST omits the table from its schema cache,
-- which surfaces as the misleading "could not find the table" error. Tables
-- created in earlier migrations (plans, budget_baselines, reforecasts) received
-- their SELECT grant from the project's baseline role setup; tables created
-- later by migration 010 did not inherit it.
--
-- FIX (additive, minimal): grant SELECT only — to authenticated only — on the
-- four governed Phase 7 read tables. This does NOT touch RLS, does NOT grant any
-- write, does NOT expose any RPC, and does NOT change actuals/variance
-- governance. Reads remain row-filtered by the existing org-membership policies;
-- writes remain locked to the service-role RPCs.
--
-- After applying this manually, reload the PostgREST schema cache (see end).
-- =====================================================================

-- Read access for signed-in users. Row visibility is still governed entirely by
-- the existing *_select_member RLS policies (public.is_org_member(...)), so this
-- grant cannot leak data across organisations.
GRANT SELECT ON TABLE
  public.actuals_batches,
  public.actuals_lines,
  public.variance_reports,
  public.variance_lines
TO authenticated;

-- Defence in depth: re-assert that writes stay revoked from anon/authenticated.
-- (Migration 010 already did this; repeating it here makes the security posture
-- of this patch self-evident and idempotent. Writes only ever happen through the
-- service-role SECURITY DEFINER RPCs.)
REVOKE INSERT, UPDATE, DELETE ON
  public.actuals_batches,
  public.actuals_lines,
  public.variance_reports,
  public.variance_lines
FROM anon, authenticated;

-- NOTE: RLS is intentionally left exactly as migration 010 configured it
-- (enabled, with the *_select_member org-scoped policies). This migration does
-- not ENABLE/DISABLE RLS, and does not create, drop or alter any policy.

-- ---------------------------------------------------------------------
-- PostgREST schema reload
-- ---------------------------------------------------------------------
-- Supabase normally reloads automatically on DDL, but when applying this by hand
-- (e.g. in the SQL editor) trigger a reload so the newly-granted tables appear
-- in the REST schema cache immediately:
NOTIFY pgrst, 'reload schema';
