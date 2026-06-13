-- Workforce Planning and Labour Budget Governance Platform
-- Phase 3.1 Layer 1 governance hardening
-- Scope: transaction-safe Layer 1 lock + handoff creation, concurrency-safe version IDs,
-- and controlled handoff status transition. No Phase 4, Layer 2, drivers, actuals, variance, waterfall or AI.

ALTER TABLE public.layer1_version_locks
  ADD CONSTRAINT layer1_version_locks_plan_version_unique UNIQUE (organisation_id, plan_id, version_id);

CREATE OR REPLACE FUNCTION public.user_has_any_org_role(
  target_organisation_id uuid,
  target_user_id uuid,
  allowed_role_names text[]
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organisation_memberships om
    JOIN public.user_roles ur
      ON ur.organisation_id = om.organisation_id
     AND ur.user_id = om.user_id
    JOIN public.roles r
      ON r.organisation_id = ur.organisation_id
     AND r.id = ur.role_id
    WHERE om.organisation_id = target_organisation_id
      AND om.user_id = target_user_id
      AND om.status = 'active'
      AND r.role_name = ANY(allowed_role_names)
  );
$$;

CREATE OR REPLACE FUNCTION public.create_layer1_lock_and_handoff(
  target_organisation_id uuid,
  target_plan_id uuid,
  target_calculation_run_id uuid,
  target_actor_user_id uuid,
  target_fiscal_year_id uuid,
  approved_snapshot jsonb,
  handoff_payload jsonb,
  target_checksum text,
  lock_reason text DEFAULT NULL
)
RETURNS TABLE(version_lock jsonb, handoff jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_run public.calculation_runs%ROWTYPE;
  new_version_number int;
  new_version_id text;
  new_version_lock public.layer1_version_locks%ROWTYPE;
  new_handoff public.layer1_handoff_objects%ROWTYPE;
  superseded_lock public.layer1_version_locks%ROWTYPE;
  superseded_handoff public.layer1_handoff_objects%ROWTYPE;
  actor_allowed boolean;
BEGIN
  actor_allowed := public.user_has_any_org_role(
    target_organisation_id,
    target_actor_user_id,
    ARRAY['owner', 'admin', 'finance_admin']
  );

  IF NOT actor_allowed THEN
    RAISE EXCEPTION 'Insufficient permission to lock Layer 1 version';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.plans p
    WHERE p.organisation_id = target_organisation_id
      AND p.id = target_plan_id
  ) THEN
    RAISE EXCEPTION 'Plan not found for organisation';
  END IF;

  IF target_fiscal_year_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.fiscal_years fy
    WHERE fy.organisation_id = target_organisation_id
      AND fy.plan_id = target_plan_id
      AND fy.id = target_fiscal_year_id
  ) THEN
    RAISE EXCEPTION 'Fiscal year not found for organisation and plan';
  END IF;

  IF approved_snapshot->>'organisation_id' IS DISTINCT FROM target_organisation_id::text
    OR approved_snapshot->>'plan_id' IS DISTINCT FROM target_plan_id::text
    OR approved_snapshot->>'approved_calculation_run_id' IS DISTINCT FROM target_calculation_run_id::text THEN
    RAISE EXCEPTION 'Approved snapshot does not match requested organisation, plan and calculation run';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(target_organisation_id::text || ':' || target_plan_id::text || ':layer1_lock', 0));

  SELECT * INTO target_run
  FROM public.calculation_runs cr
  WHERE cr.organisation_id = target_organisation_id
    AND cr.plan_id = target_plan_id
    AND cr.id = target_calculation_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calculation run not found for organisation and plan';
  END IF;

  IF target_run.run_status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved Layer 1 calculation runs can be locked';
  END IF;

  SELECT COALESCE(MAX((substring(version_id from '^L1-V([0-9]+)$'))::int), 0) + 1
  INTO new_version_number
  FROM public.layer1_version_locks
  WHERE organisation_id = target_organisation_id
    AND plan_id = target_plan_id;

  new_version_id := 'L1-V' || lpad(new_version_number::text, 3, '0');

  FOR superseded_lock IN
    UPDATE public.layer1_version_locks
    SET approval_status = 'superseded',
        change_reason = 'Superseded by ' || new_version_id
    WHERE organisation_id = target_organisation_id
      AND plan_id = target_plan_id
      AND approval_status IN ('approved', 'locked')
    RETURNING *
  LOOP
    INSERT INTO public.audit_events (
      organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id,
      old_value_json, new_value_json, reason
    ) VALUES (
      target_organisation_id, target_actor_user_id, 'layer1.version.superseded', 'layer1_version_lock', superseded_lock.id, target_plan_id,
      jsonb_build_object('approval_status', superseded_lock.approval_status),
      jsonb_build_object('approval_status', 'superseded'),
      'Superseded by ' || new_version_id
    );
  END LOOP;

  FOR superseded_handoff IN
    UPDATE public.layer1_handoff_objects
    SET handoff_status = 'superseded'
    WHERE organisation_id = target_organisation_id
      AND plan_id = target_plan_id
      AND handoff_status IN ('approved', 'locked', 'ready_for_layer2')
    RETURNING *
  LOOP
    INSERT INTO public.audit_events (
      organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id,
      old_value_json, new_value_json, reason
    ) VALUES (
      target_organisation_id, target_actor_user_id, 'layer1.handoff.superseded', 'layer1_handoff_object', superseded_handoff.id, target_plan_id,
      jsonb_build_object('handoff_status', superseded_handoff.handoff_status),
      jsonb_build_object('handoff_status', 'superseded'),
      'Superseded by ' || new_version_id
    );
  END LOOP;

  INSERT INTO public.layer1_version_locks (
    organisation_id,
    plan_id,
    fiscal_year_id,
    version_id,
    approved_calculation_run_id,
    approval_status,
    approved_by,
    approved_at,
    locked_by,
    locked_at,
    checksum,
    change_reason,
    approved_snapshot_json,
    approval_notes,
    is_immutable
  ) VALUES (
    target_organisation_id,
    target_plan_id,
    target_fiscal_year_id,
    new_version_id,
    target_calculation_run_id,
    'locked',
    COALESCE(target_run.approved_by, target_actor_user_id),
    COALESCE(target_run.approved_at, now()),
    target_actor_user_id,
    now(),
    target_checksum,
    lock_reason,
    approved_snapshot,
    COALESCE(target_run.approval_notes, lock_reason),
    true
  )
  RETURNING * INTO new_version_lock;

  UPDATE public.calculation_runs
  SET run_status = 'locked'
  WHERE organisation_id = target_organisation_id
    AND plan_id = target_plan_id
    AND id = target_calculation_run_id;

  INSERT INTO public.layer1_handoff_objects (
    organisation_id,
    plan_id,
    fiscal_year_id,
    version_lock_id,
    approved_calculation_run_id,
    handoff_status,
    source_quality_score,
    confidence_score,
    assumption_risk_level,
    demand_inputs_json,
    hidden_work_inputs_json,
    workload_outputs_json,
    required_fte_outputs_json,
    supply_gap_outputs_json,
    labour_budget_outputs_json,
    scenario_outputs_json,
    key_assumptions_json,
    unresolved_risks_json,
    source_summary_json,
    risk_summary_json,
    annualisation_note,
    created_by,
    is_immutable
  ) VALUES (
    target_organisation_id,
    target_plan_id,
    target_fiscal_year_id,
    new_version_lock.id,
    target_calculation_run_id,
    'locked',
    COALESCE(NULLIF(handoff_payload->>'source_quality_score', '')::numeric, 0),
    COALESCE(NULLIF(handoff_payload->>'confidence_score', '')::numeric, 0),
    COALESCE(handoff_payload->>'assumption_risk_level', 'low'),
    COALESCE(handoff_payload->'demand_inputs_json', '[]'::jsonb),
    COALESCE(handoff_payload->'hidden_work_inputs_json', '[]'::jsonb),
    COALESCE(handoff_payload->'workload_outputs_json', '{}'::jsonb),
    COALESCE(handoff_payload->'required_fte_outputs_json', '{}'::jsonb),
    COALESCE(handoff_payload->'supply_gap_outputs_json', '{}'::jsonb),
    COALESCE(handoff_payload->'labour_budget_outputs_json', '{}'::jsonb),
    COALESCE(handoff_payload->'scenario_outputs_json', '[]'::jsonb),
    COALESCE(handoff_payload->'key_assumptions_json', '{}'::jsonb),
    COALESCE(handoff_payload->'unresolved_risks_json', '[]'::jsonb),
    COALESCE(handoff_payload->'source_summary_json', '[]'::jsonb),
    COALESCE(handoff_payload->'risk_summary_json', '[]'::jsonb),
    handoff_payload->>'annualisation_note',
    target_actor_user_id,
    true
  )
  RETURNING * INTO new_handoff;

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id,
    new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'layer1.version_locked', 'layer1_version_lock', new_version_lock.id, target_plan_id,
    to_jsonb(new_version_lock),
    COALESCE(lock_reason, 'Layer 1 version locked')
  );

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id,
    new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'layer1.handoff.created', 'layer1_handoff_object', new_handoff.id, target_plan_id,
    to_jsonb(new_handoff),
    'Layer 1 handoff object created for future Layer 2 baseline setup'
  );

  RETURN QUERY SELECT to_jsonb(new_version_lock), to_jsonb(new_handoff);
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_layer1_handoff_status_controlled(
  target_organisation_id uuid,
  target_plan_id uuid,
  target_handoff_id uuid,
  target_actor_user_id uuid,
  next_status text,
  transition_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_handoff public.layer1_handoff_objects%ROWTYPE;
  updated_handoff public.layer1_handoff_objects%ROWTYPE;
BEGIN
  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin']) THEN
    RAISE EXCEPTION 'Insufficient permission for Layer 1 handoff transition';
  END IF;

  SELECT * INTO current_handoff
  FROM public.layer1_handoff_objects
  WHERE organisation_id = target_organisation_id
    AND plan_id = target_plan_id
    AND id = target_handoff_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Layer 1 handoff object not found for organisation and plan';
  END IF;

  UPDATE public.layer1_handoff_objects
  SET handoff_status = next_status
  WHERE organisation_id = target_organisation_id
    AND plan_id = target_plan_id
    AND id = target_handoff_id
  RETURNING * INTO updated_handoff;

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id,
    target_actor_user_id,
    CASE
      WHEN next_status = 'ready_for_layer2' THEN 'layer1.handoff.ready_for_layer2'
      ELSE 'layer1.handoff.status_changed'
    END,
    'layer1_handoff_object',
    target_handoff_id,
    target_plan_id,
    jsonb_build_object('handoff_status', current_handoff.handoff_status),
    jsonb_build_object('handoff_status', next_status),
    COALESCE(transition_reason, 'Layer 1 handoff status changed')
  );

  RETURN to_jsonb(updated_handoff);
END;
$$;

REVOKE ALL ON FUNCTION public.user_has_any_org_role(uuid, uuid, text[]) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.create_layer1_lock_and_handoff(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_layer1_handoff_status_controlled(uuid, uuid, uuid, uuid, text, text) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.user_has_any_org_role(uuid, uuid, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_layer1_lock_and_handoff(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_layer1_handoff_status_controlled(uuid, uuid, uuid, uuid, text, text) TO service_role;
