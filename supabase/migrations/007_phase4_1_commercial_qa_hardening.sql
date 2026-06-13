-- Workforce Planning and Labour Budget Governance Platform
-- Phase 4.1 commercial QA hardening
-- Scope: Budget Baseline locked snapshot accuracy and repeatable quality proof support.
-- No Phase 5, drivers, reforecasting, actuals, variance, waterfall or AI.


-- Layer 1 governed lock and handoff records must be created only through the
-- transaction-safe service-role RPC. Remove older direct insert policies from
-- the Phase 1 scaffold now that governance is implemented.
DROP POLICY IF EXISTS layer1_version_locks_finance_insert ON public.layer1_version_locks;
DROP POLICY IF EXISTS layer1_handoff_objects_finance_insert ON public.layer1_handoff_objects;
REVOKE INSERT, UPDATE, DELETE ON public.layer1_version_locks FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.layer1_handoff_objects FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.lock_budget_baseline(
  target_organisation_id uuid,
  target_plan_id uuid,
  target_fiscal_year_id uuid,
  target_budget_baseline_id uuid,
  target_actor_user_id uuid,
  snapshot_payload jsonb,
  target_checksum text,
  lock_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_baseline public.budget_baselines%ROWTYPE;
  locked_baseline public.budget_baselines%ROWTYPE;
  new_snapshot public.budget_baseline_snapshots%ROWTYPE;
  line_count int;
  budget_delta numeric;
  labour_delta numeric;
  workload_delta numeric;
  lock_time timestamptz;
BEGIN
  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin']) THEN
    RAISE EXCEPTION 'Insufficient permission to lock budget baseline';
  END IF;

  lock_time := COALESCE(NULLIF(snapshot_payload #>> '{governance,locked_at}', '')::timestamptz, now());

  IF snapshot_payload #>> '{baseline,status}' IS DISTINCT FROM 'locked' THEN
    RAISE EXCEPTION 'Budget baseline snapshot must represent the final locked baseline status';
  END IF;

  IF snapshot_payload #>> '{baseline,locked_by}' IS DISTINCT FROM target_actor_user_id::text THEN
    RAISE EXCEPTION 'Budget baseline snapshot locked_by does not match actor';
  END IF;

  IF NULLIF(snapshot_payload #>> '{baseline,locked_at}', '') IS NOT NULL
     AND (snapshot_payload #>> '{baseline,locked_at}')::timestamptz IS DISTINCT FROM lock_time THEN
    RAISE EXCEPTION 'Budget baseline snapshot locked_at does not match governance lock timestamp';
  END IF;

  IF snapshot_payload #>> '{baseline,is_immutable}' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Budget baseline snapshot must mark the final baseline header immutable';
  END IF;

  IF snapshot_payload #>> '{baseline,checksum}' IS DISTINCT FROM target_checksum
     OR snapshot_payload #>> '{governance,checksum}' IS DISTINCT FROM target_checksum
     OR snapshot_payload #>> '{snapshot_checksum}' IS DISTINCT FROM target_checksum THEN
    RAISE EXCEPTION 'Budget baseline snapshot checksum does not match target checksum';
  END IF;

  SELECT * INTO target_baseline
  FROM public.budget_baselines
  WHERE organisation_id = target_organisation_id
    AND plan_id = target_plan_id
    AND fiscal_year_id = target_fiscal_year_id
    AND id = target_budget_baseline_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget baseline not found for organisation, plan and fiscal year';
  END IF;

  IF target_baseline.status NOT IN ('draft', 'reviewed') THEN
    RAISE EXCEPTION 'Only draft or reviewed budget baselines can be locked';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.budget_baselines existing
    WHERE existing.organisation_id = target_organisation_id
      AND existing.plan_id = target_plan_id
      AND existing.fiscal_year_id = target_fiscal_year_id
      AND existing.status = 'locked'
      AND existing.id <> target_budget_baseline_id
  ) THEN
    RAISE EXCEPTION 'A locked budget baseline already exists for this plan and fiscal year';
  END IF;

  SELECT COUNT(*),
         COALESCE(SUM(budget_amount), 0) - target_baseline.annual_budget_amount,
         COALESCE(SUM(labour_cost), 0) - target_baseline.annual_labour_cost,
         COALESCE(SUM(workload_hours), 0) - target_baseline.annual_workload_hours
  INTO line_count, budget_delta, labour_delta, workload_delta
  FROM public.budget_baseline_lines
  WHERE organisation_id = target_organisation_id
    AND budget_baseline_id = target_budget_baseline_id;

  IF line_count <> 12 THEN
    RAISE EXCEPTION 'Budget baseline requires 12 monthly lines before lock';
  END IF;

  IF abs(budget_delta) > 0.05 OR abs(labour_delta) > 0.05 OR abs(workload_delta) > 0.05 THEN
    RAISE EXCEPTION 'Budget baseline monthly phasing does not reconcile to annual totals';
  END IF;

  UPDATE public.budget_baselines
  SET status = 'locked',
      locked_by = target_actor_user_id,
      locked_at = lock_time,
      checksum = target_checksum,
      is_immutable = true
  WHERE organisation_id = target_organisation_id
    AND id = target_budget_baseline_id
  RETURNING * INTO locked_baseline;

  UPDATE public.budget_baseline_lines
  SET is_immutable = true
  WHERE organisation_id = target_organisation_id
    AND budget_baseline_id = target_budget_baseline_id;

  INSERT INTO public.budget_baseline_snapshots (
    organisation_id,
    plan_id,
    fiscal_year_id,
    budget_baseline_id,
    snapshot_json,
    checksum,
    locked_by,
    locked_at,
    is_immutable
  ) VALUES (
    target_organisation_id,
    target_plan_id,
    target_fiscal_year_id,
    target_budget_baseline_id,
    snapshot_payload,
    target_checksum,
    target_actor_user_id,
    lock_time,
    true
  ) RETURNING * INTO new_snapshot;

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    new_value_json, reason
  ) VALUES (
    target_organisation_id,
    target_actor_user_id,
    'budget_baseline.locked',
    'budget_baseline',
    target_budget_baseline_id,
    target_plan_id,
    target_fiscal_year_id,
    to_jsonb(locked_baseline),
    COALESCE(lock_reason, 'Budget baseline locked')
  );

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    new_value_json, reason
  ) VALUES (
    target_organisation_id,
    target_actor_user_id,
    'budget_baseline.snapshot_created',
    'budget_baseline_snapshot',
    new_snapshot.id,
    target_plan_id,
    target_fiscal_year_id,
    to_jsonb(new_snapshot),
    'Immutable budget baseline snapshot created from final locked baseline state'
  );

  RETURN jsonb_build_object('baseline', to_jsonb(locked_baseline), 'snapshot', to_jsonb(new_snapshot));
END;
$$;

REVOKE ALL ON FUNCTION public.lock_budget_baseline(uuid, uuid, uuid, uuid, uuid, jsonb, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_budget_baseline(uuid, uuid, uuid, uuid, uuid, jsonb, text, text) TO service_role;
