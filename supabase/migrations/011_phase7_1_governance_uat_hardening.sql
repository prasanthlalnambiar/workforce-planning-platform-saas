-- Workforce Planning and Labour Budget Governance Platform
-- Phase 7.1 Governance + UAT Hardening Patch
-- Scope: privilege hardening of every service-role-only governance RPC
-- (PUBLIC/anon/authenticated execute revoked + internal service-role guard),
-- database-side context guards for actuals/variance, database-derived planning
-- period metadata, database-side variance line consistency validation against
-- source-of-truth rows. No product scope change; no waterfall; no AI.

-- ---------------------------------------------------------------------------
-- Helper: derive planning period metadata from planning_periods.
-- Caller-provided period_number/period_start/period_end are never trusted.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.derive_planning_period(
  target_organisation_id uuid,
  target_fiscal_year_id uuid,
  target_period_id uuid,
  OUT derived_period_number integer,
  OUT derived_period_start date,
  OUT derived_period_end date
)
RETURNS record
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT period_number, period_start, period_end
  INTO derived_period_number, derived_period_start, derived_period_end
  FROM public.planning_periods
  WHERE organisation_id = target_organisation_id
    AND fiscal_year_id = target_fiscal_year_id
    AND id = target_period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Planning period does not belong to this organisation and fiscal-year context';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Helper: database-side variance line consistency validation.
-- Every submitted variance line is verified against stored source-of-truth
-- rows (posted actuals_lines, pinned reforecast_lines, locked
-- budget_baseline_lines, valid planning_periods). This protects the database
-- even if the server payload is wrong or tampered with.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_variance_lines_consistent(
  target_organisation_id uuid,
  target_batch_id uuid,
  target_reforecast_id uuid,
  target_baseline_id uuid,
  target_fiscal_year_id uuid,
  line_payloads jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  line_item jsonb;
  target_period_id uuid;
  src_actual public.actuals_lines%ROWTYPE;
  src_forecast public.reforecast_lines%ROWTYPE;
  src_baseline public.budget_baseline_lines%ROWTYPE;
  expected_pct numeric;
  payload_pct numeric;
  actuals_line_count integer;
  seen_period_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF line_payloads IS NULL OR jsonb_typeof(line_payloads) <> 'array' OR jsonb_array_length(line_payloads) = 0 THEN
    RAISE EXCEPTION 'Variance lines are required';
  END IF;

  SELECT COUNT(*) INTO actuals_line_count
  FROM public.actuals_lines
  WHERE organisation_id = target_organisation_id AND actuals_batch_id = target_batch_id;

  IF jsonb_array_length(line_payloads) <> actuals_line_count THEN
    RAISE EXCEPTION 'Variance line consistency failed: payload covers % periods but the posted actuals batch covers %', jsonb_array_length(line_payloads), actuals_line_count;
  END IF;

  FOR line_item IN SELECT * FROM jsonb_array_elements(line_payloads)
  LOOP
    target_period_id := (line_item->>'planning_period_id')::uuid;
    PERFORM public.derive_planning_period(target_organisation_id, target_fiscal_year_id, target_period_id);

    IF target_period_id = ANY(seen_period_ids) THEN
      RAISE EXCEPTION 'Variance line consistency failed: duplicate planning period in payload';
    END IF;
    seen_period_ids := array_append(seen_period_ids, target_period_id);

    SELECT * INTO src_actual
    FROM public.actuals_lines
    WHERE organisation_id = target_organisation_id AND actuals_batch_id = target_batch_id AND planning_period_id = target_period_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variance line consistency failed: period has no row in the posted actuals batch';
    END IF;

    SELECT * INTO src_forecast
    FROM public.reforecast_lines
    WHERE organisation_id = target_organisation_id AND reforecast_id = target_reforecast_id AND period_id = target_period_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variance line consistency failed: period has no row in the pinned locked forecast';
    END IF;

    SELECT * INTO src_baseline
    FROM public.budget_baseline_lines
    WHERE organisation_id = target_organisation_id AND budget_baseline_id = target_baseline_id AND period_id = target_period_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variance line consistency failed: period has no row in the locked baseline';
    END IF;

    -- Source-of-truth value checks (actuals / forecast / baseline)
    IF abs(COALESCE((line_item->>'actual_cost')::numeric, 0) - src_actual.actual_cost) > 0.01
      OR abs(COALESCE((line_item->>'actual_fte')::numeric, 0) - src_actual.actual_fte) > 0.01
      OR abs(COALESCE((line_item->>'actual_workload_hours')::numeric, 0) - src_actual.actual_workload_hours) > 0.01 THEN
      RAISE EXCEPTION 'Variance line consistency failed: actual values do not match the posted actuals line';
    END IF;

    IF abs(COALESCE((line_item->>'forecast_cost')::numeric, 0) - src_forecast.forecast_budget_amount) > 0.01
      OR abs(COALESCE((line_item->>'forecast_fte')::numeric, 0) - src_forecast.forecast_required_fte) > 0.01
      OR abs(COALESCE((line_item->>'forecast_workload_hours')::numeric, 0) - src_forecast.forecast_workload_hours) > 0.01 THEN
      RAISE EXCEPTION 'Variance line consistency failed: forecast values do not match the pinned reforecast line';
    END IF;

    IF abs(COALESCE((line_item->>'baseline_cost')::numeric, 0) - src_baseline.budget_amount) > 0.01
      OR abs(COALESCE((line_item->>'baseline_fte')::numeric, 0) - src_baseline.required_fte) > 0.01
      OR abs(COALESCE((line_item->>'baseline_workload_hours')::numeric, 0) - src_baseline.workload_hours) > 0.01 THEN
      RAISE EXCEPTION 'Variance line consistency failed: baseline values do not match the locked baseline line';
    END IF;

    -- Variance arithmetic checks: variance = actual - comparator
    IF abs((src_actual.actual_cost - src_forecast.forecast_budget_amount) - COALESCE((line_item->>'cost_variance_to_forecast')::numeric, 0)) > 0.01
      OR abs((src_actual.actual_cost - src_baseline.budget_amount) - COALESCE((line_item->>'cost_variance_to_baseline')::numeric, 0)) > 0.01
      OR abs((src_actual.actual_fte - src_forecast.forecast_required_fte) - COALESCE((line_item->>'fte_variance_to_forecast')::numeric, 0)) > 0.01
      OR abs((src_actual.actual_fte - src_baseline.required_fte) - COALESCE((line_item->>'fte_variance_to_baseline')::numeric, 0)) > 0.01
      OR abs((src_actual.actual_workload_hours - src_forecast.forecast_workload_hours) - COALESCE((line_item->>'workload_variance_to_forecast')::numeric, 0)) > 0.01
      OR abs((src_actual.actual_workload_hours - src_baseline.workload_hours) - COALESCE((line_item->>'workload_variance_to_baseline')::numeric, 0)) > 0.01 THEN
      RAISE EXCEPTION 'Variance line consistency failed: variance does not equal actual minus comparator';
    END IF;

    -- Percentage safety: zero comparator must yield NULL, otherwise pct must
    -- match variance / comparator * 100 within tolerance.
    IF src_forecast.forecast_budget_amount = 0 THEN
      IF line_item->>'cost_variance_to_forecast_pct' IS NOT NULL THEN
        RAISE EXCEPTION 'Variance line consistency failed: percentage must be null for a zero forecast comparator';
      END IF;
    ELSE
      expected_pct := round(((src_actual.actual_cost - src_forecast.forecast_budget_amount) / src_forecast.forecast_budget_amount) * 100, 2);
      payload_pct := (line_item->>'cost_variance_to_forecast_pct')::numeric;
      IF payload_pct IS NULL OR abs(payload_pct - expected_pct) > 0.05 THEN
        RAISE EXCEPTION 'Variance line consistency failed: forecast variance percentage is inconsistent';
      END IF;
    END IF;

    IF src_baseline.budget_amount = 0 THEN
      IF line_item->>'cost_variance_to_baseline_pct' IS NOT NULL THEN
        RAISE EXCEPTION 'Variance line consistency failed: percentage must be null for a zero baseline comparator';
      END IF;
    ELSE
      expected_pct := round(((src_actual.actual_cost - src_baseline.budget_amount) / src_baseline.budget_amount) * 100, 2);
      payload_pct := (line_item->>'cost_variance_to_baseline_pct')::numeric;
      IF payload_pct IS NULL OR abs(payload_pct - expected_pct) > 0.05 THEN
        RAISE EXCEPTION 'Variance line consistency failed: baseline variance percentage is inconsistent';
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Re-emitted: insert_actuals_lines now derives period metadata from
-- planning_periods. Caller-provided period metadata is never persisted.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.insert_actuals_lines(
  target_organisation_id uuid,
  target_batch record,
  line_payloads jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  line_item jsonb;
  derived record;
BEGIN
  FOR line_item IN SELECT * FROM jsonb_array_elements(line_payloads)
  LOOP
    derived := public.derive_planning_period(
      target_organisation_id,
      target_batch.fiscal_year_id,
      (line_item->>'planning_period_id')::uuid
    );

    INSERT INTO public.actuals_lines (
      organisation_id, actuals_batch_id, planning_period_id,
      period_number, period_start, period_end,
      actual_cost, actual_fte, actual_workload_hours,
      source_row_reference, created_by
    ) VALUES (
      target_organisation_id,
      target_batch.id,
      (line_item->>'planning_period_id')::uuid,
      derived.derived_period_number,
      derived.derived_period_start,
      derived.derived_period_end,
      COALESCE((line_item->>'actual_cost')::numeric, 0),
      COALESCE((line_item->>'actual_fte')::numeric, 0),
      COALESCE((line_item->>'actual_workload_hours')::numeric, 0),
      line_item->>'source_row_reference',
      target_batch.created_by
    );
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Re-emitted: insert_variance_lines (shared by create/recalculate) with
-- database-derived period metadata.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.insert_variance_lines(
  target_organisation_id uuid,
  target_report record,
  line_payloads jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  line_item jsonb;
  derived record;
BEGIN
  FOR line_item IN SELECT * FROM jsonb_array_elements(line_payloads)
  LOOP
    derived := public.derive_planning_period(
      target_organisation_id,
      target_report.fiscal_year_id,
      (line_item->>'planning_period_id')::uuid
    );

    INSERT INTO public.variance_lines (
      organisation_id, variance_report_id, planning_period_id,
      period_number, period_start, period_end,
      actual_cost, forecast_cost, baseline_cost,
      cost_variance_to_forecast, cost_variance_to_forecast_pct,
      cost_variance_to_baseline, cost_variance_to_baseline_pct,
      actual_fte, forecast_fte, baseline_fte,
      fte_variance_to_forecast, fte_variance_to_baseline,
      actual_workload_hours, forecast_workload_hours, baseline_workload_hours,
      workload_variance_to_forecast, workload_variance_to_baseline,
      created_by
    ) VALUES (
      target_organisation_id,
      target_report.id,
      (line_item->>'planning_period_id')::uuid,
      derived.derived_period_number,
      derived.derived_period_start,
      derived.derived_period_end,
      COALESCE((line_item->>'actual_cost')::numeric, 0),
      COALESCE((line_item->>'forecast_cost')::numeric, 0),
      COALESCE((line_item->>'baseline_cost')::numeric, 0),
      COALESCE((line_item->>'cost_variance_to_forecast')::numeric, 0),
      (line_item->>'cost_variance_to_forecast_pct')::numeric,
      COALESCE((line_item->>'cost_variance_to_baseline')::numeric, 0),
      (line_item->>'cost_variance_to_baseline_pct')::numeric,
      COALESCE((line_item->>'actual_fte')::numeric, 0),
      COALESCE((line_item->>'forecast_fte')::numeric, 0),
      COALESCE((line_item->>'baseline_fte')::numeric, 0),
      COALESCE((line_item->>'fte_variance_to_forecast')::numeric, 0),
      COALESCE((line_item->>'fte_variance_to_baseline')::numeric, 0),
      COALESCE((line_item->>'actual_workload_hours')::numeric, 0),
      COALESCE((line_item->>'forecast_workload_hours')::numeric, 0),
      COALESCE((line_item->>'baseline_workload_hours')::numeric, 0),
      COALESCE((line_item->>'workload_variance_to_forecast')::numeric, 0),
      COALESCE((line_item->>'workload_variance_to_baseline')::numeric, 0),
      target_report.created_by
    );
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Re-emitted governance RPCs with service-role guards, database-side context
-- guards and source-of-truth validation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_actuals_batch(
  target_organisation_id uuid,
  target_actor_user_id uuid,
  batch_payload jsonb,
  line_payloads jsonb,
  create_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_baseline public.budget_baselines%ROWTYPE;
  new_batch public.actuals_batches%ROWTYPE;
  next_code_number integer;
  next_version integer;
  context_reforecast public.reforecasts%ROWTYPE;
BEGIN
  -- UAT hardening: SECURITY DEFINER governance RPCs accept a target actor id,
  -- so they must be executable by the server-side service role only.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'This RPC may only be executed by the service role';
  END IF;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin', 'planner']) THEN
    RAISE EXCEPTION 'Insufficient permission to create actuals batches';
  END IF;

  SELECT * INTO target_baseline
  FROM public.budget_baselines
  WHERE organisation_id = target_organisation_id
    AND id = (batch_payload->>'baseline_id')::uuid
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget baseline not found for organisation';
  END IF;

  IF target_baseline.status <> 'locked' THEN
    RAISE EXCEPTION 'Actuals can only be loaded against a locked budget baseline';
  END IF;

  -- UAT hardening: a recorded forecast context must belong to the same
  -- organisation and baseline context as the actuals batch.
  IF NULLIF(batch_payload->>'reforecast_id', '') IS NOT NULL THEN
    SELECT * INTO context_reforecast
    FROM public.reforecasts
    WHERE organisation_id = target_organisation_id
      AND id = (batch_payload->>'reforecast_id')::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Forecast context not found for organisation';
    END IF;
    IF context_reforecast.budget_baseline_id <> target_baseline.id
      OR context_reforecast.plan_id <> target_baseline.plan_id
      OR context_reforecast.fiscal_year_id <> target_baseline.fiscal_year_id THEN
      RAISE EXCEPTION 'Forecast context must belong to the same baseline, plan and fiscal year as the actuals batch';
    END IF;
    IF context_reforecast.status NOT IN ('locked', 'superseded') THEN
      RAISE EXCEPTION 'Forecast context must be a locked forecast version';
    END IF;
  END IF;

  PERFORM public.assert_actuals_lines_valid(target_organisation_id, target_baseline.fiscal_year_id, line_payloads);

  PERFORM pg_advisory_xact_lock(hashtext(target_organisation_id::text || ':' || target_baseline.id::text || ':actuals_batch_code'));

  SELECT COALESCE(COUNT(*), 0) + 1 INTO next_code_number
  FROM public.actuals_batches
  WHERE organisation_id = target_organisation_id
    AND plan_id = target_baseline.plan_id
    AND fiscal_year_id = target_baseline.fiscal_year_id;

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_version
  FROM public.actuals_batches
  WHERE organisation_id = target_organisation_id
    AND baseline_id = target_baseline.id;

  INSERT INTO public.actuals_batches (
    organisation_id, plan_id, fiscal_year_id, baseline_id, reforecast_id,
    batch_code, batch_name, version_number, status, source_type,
    uploaded_by, checksum, created_by
  ) VALUES (
    target_organisation_id,
    target_baseline.plan_id,
    target_baseline.fiscal_year_id,
    target_baseline.id,
    NULLIF(batch_payload->>'reforecast_id', '')::uuid,
    'ACT-' || lpad(next_code_number::text, 4, '0'),
    batch_payload->>'batch_name',
    next_version,
    'draft',
    COALESCE(batch_payload->>'source_type', 'manual'),
    target_actor_user_id,
    batch_payload->>'checksum',
    target_actor_user_id
  )
  RETURNING * INTO new_batch;

  PERFORM public.insert_actuals_lines(target_organisation_id, new_batch, line_payloads);

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'actuals.batch_created', 'actuals_batch', new_batch.id,
    new_batch.plan_id, new_batch.fiscal_year_id,
    NULL,
    jsonb_build_object('batch_code', new_batch.batch_code, 'version_number', new_batch.version_number, 'source_type', new_batch.source_type, 'checksum', new_batch.checksum),
    COALESCE(create_reason, 'Draft actuals batch created')
  );

  RETURN to_jsonb(new_batch);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_variance_report(
  target_organisation_id uuid,
  target_actor_user_id uuid,
  report_payload jsonb,
  line_payloads jsonb,
  create_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_batch public.actuals_batches%ROWTYPE;
  target_reforecast public.reforecasts%ROWTYPE;
  new_report public.variance_reports%ROWTYPE;
  next_code_number integer;
BEGIN
  -- UAT hardening: SECURITY DEFINER governance RPCs accept a target actor id,
  -- so they must be executable by the server-side service role only.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'This RPC may only be executed by the service role';
  END IF;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin', 'planner']) THEN
    RAISE EXCEPTION 'Insufficient permission to create variance reports';
  END IF;

  SELECT * INTO target_batch
  FROM public.actuals_batches
  WHERE organisation_id = target_organisation_id
    AND id = (report_payload->>'actuals_batch_id')::uuid
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Actuals batch not found for organisation';
  END IF;

  IF target_batch.status <> 'posted' THEN
    RAISE EXCEPTION 'Variance can only be calculated from posted actuals';
  END IF;

  SELECT * INTO target_reforecast
  FROM public.reforecasts
  WHERE organisation_id = target_organisation_id
    AND id = (report_payload->>'reforecast_id')::uuid
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reforecast not found for organisation';
  END IF;

  IF target_reforecast.status NOT IN ('locked', 'superseded') THEN
    RAISE EXCEPTION 'Variance must compare against a locked forecast version';
  END IF;

  IF target_reforecast.lock_version_id IS NULL OR target_reforecast.checksum IS NULL THEN
    RAISE EXCEPTION 'Variance comparator must carry a lock version and checksum';
  END IF;

  -- UAT hardening: the database independently enforces that the actuals batch
  -- and the pinned forecast share the same baseline context.
  IF target_reforecast.budget_baseline_id <> target_batch.baseline_id
    OR target_reforecast.plan_id <> target_batch.plan_id
    OR target_reforecast.fiscal_year_id <> target_batch.fiscal_year_id THEN
    RAISE EXCEPTION 'Variance rejected: actuals batch and forecast must belong to the same baseline, plan and fiscal year';
  END IF;

  IF jsonb_typeof(line_payloads) <> 'array' OR jsonb_array_length(line_payloads) = 0 THEN
    RAISE EXCEPTION 'Variance lines are required';
  END IF;

  -- UAT hardening: every submitted variance line is verified against stored
  -- source-of-truth rows before anything is inserted.
  PERFORM public.assert_variance_lines_consistent(
    target_organisation_id,
    target_batch.id,
    target_reforecast.id,
    target_batch.baseline_id,
    target_batch.fiscal_year_id,
    line_payloads
  );

  PERFORM pg_advisory_xact_lock(hashtext(target_organisation_id::text || ':' || target_batch.plan_id::text || ':variance_report_code'));

  SELECT COALESCE(COUNT(*), 0) + 1 INTO next_code_number
  FROM public.variance_reports
  WHERE organisation_id = target_organisation_id
    AND plan_id = target_batch.plan_id
    AND fiscal_year_id = target_batch.fiscal_year_id;

  INSERT INTO public.variance_reports (
    organisation_id, plan_id, fiscal_year_id, baseline_id, reforecast_id, actuals_batch_id,
    report_code, report_name, status,
    comparator_lock_version_id, comparator_checksum, baseline_checksum,
    actuals_checksum, actuals_version_number, created_by
  ) VALUES (
    target_organisation_id,
    target_batch.plan_id,
    target_batch.fiscal_year_id,
    target_batch.baseline_id,
    target_reforecast.id,
    target_batch.id,
    'VAR-' || lpad(next_code_number::text, 4, '0'),
    report_payload->>'report_name',
    'draft',
    target_reforecast.lock_version_id,
    target_reforecast.checksum,
    report_payload->>'baseline_checksum',
    COALESCE(target_batch.checksum, ''),
    target_batch.version_number,
    target_actor_user_id
  )
  RETURNING * INTO new_report;

  PERFORM public.insert_variance_lines(target_organisation_id, new_report, line_payloads);

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'variance.report_created', 'variance_report', new_report.id,
    new_report.plan_id, new_report.fiscal_year_id,
    NULL,
    jsonb_build_object(
      'report_code', new_report.report_code,
      'actuals_batch_id', new_report.actuals_batch_id,
      'comparator_lock_version_id', new_report.comparator_lock_version_id,
      'comparator_checksum', new_report.comparator_checksum,
      'actuals_checksum', new_report.actuals_checksum
    ),
    COALESCE(create_reason, 'Variance report created pinned to a locked forecast version')
  );

  RETURN to_jsonb(new_report);
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_variance_report(
  target_organisation_id uuid,
  target_actor_user_id uuid,
  target_report_id uuid,
  line_payloads jsonb,
  recalculate_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_report public.variance_reports%ROWTYPE;
BEGIN
  -- UAT hardening: SECURITY DEFINER governance RPCs accept a target actor id,
  -- so they must be executable by the server-side service role only.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'This RPC may only be executed by the service role';
  END IF;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin', 'planner']) THEN
    RAISE EXCEPTION 'Insufficient permission to recalculate variance reports';
  END IF;

  SELECT * INTO current_report
  FROM public.variance_reports
  WHERE organisation_id = target_organisation_id AND id = target_report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variance report not found for organisation';
  END IF;

  IF current_report.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft variance reports can be recalculated';
  END IF;

  IF jsonb_typeof(line_payloads) <> 'array' OR jsonb_array_length(line_payloads) = 0 THEN
    RAISE EXCEPTION 'Variance lines are required';
  END IF;

  -- UAT hardening: recalculated lines are verified against the SAME pinned
  -- source-of-truth rows recorded at creation.
  PERFORM public.assert_variance_lines_consistent(
    target_organisation_id,
    current_report.actuals_batch_id,
    current_report.reforecast_id,
    current_report.baseline_id,
    current_report.fiscal_year_id,
    line_payloads
  );

  DELETE FROM public.variance_lines
  WHERE organisation_id = target_organisation_id AND variance_report_id = target_report_id;

  PERFORM public.insert_variance_lines(target_organisation_id, current_report, line_payloads);

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'variance.report_recalculated', 'variance_report', current_report.id,
    current_report.plan_id, current_report.fiscal_year_id,
    NULL,
    jsonb_build_object('comparator_lock_version_id', current_report.comparator_lock_version_id),
    COALESCE(recalculate_reason, 'Draft variance report recalculated against pinned comparators')
  );

  RETURN to_jsonb(current_report);
END;
$$;

-- ---------------------------------------------------------------------------
-- Re-emitted: every remaining service-role-only governance RPC across phases
-- 3.1 through 6 now carries the internal service-role guard.
-- ---------------------------------------------------------------------------

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
  -- UAT hardening: SECURITY DEFINER governance RPCs accept a target actor id,
  -- so they must be executable by the server-side service role only.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'This RPC may only be executed by the service role';
  END IF;

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
  allowed_roles text[];
BEGIN
  -- UAT hardening: SECURITY DEFINER governance RPCs accept a target actor id,
  -- so they must be executable by the server-side service role only.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'This RPC may only be executed by the service role';
  END IF;

  allowed_roles := CASE
    WHEN next_status = 'imported_to_baseline' THEN ARRAY['owner', 'admin', 'finance_admin', 'planner']
    ELSE ARRAY['owner', 'admin', 'finance_admin']
  END;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, allowed_roles) THEN
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
      WHEN next_status = 'imported_to_baseline' THEN 'layer1.handoff.imported_to_baseline'
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

CREATE OR REPLACE FUNCTION public.create_budget_baseline_draft(
  target_organisation_id uuid,
  target_actor_user_id uuid,
  baseline_payload jsonb,
  line_payloads jsonb,
  create_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_baseline public.budget_baselines%ROWTYPE;
  inserted_lines jsonb;
  source_handoff public.layer1_handoff_objects%ROWTYPE;
  line_item jsonb;
  source_type_value text;
  plan_value uuid;
  fiscal_year_value uuid;
BEGIN
  -- UAT hardening: SECURITY DEFINER governance RPCs accept a target actor id,
  -- so they must be executable by the server-side service role only.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'This RPC may only be executed by the service role';
  END IF;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin', 'planner']) THEN
    RAISE EXCEPTION 'Insufficient permission to create budget baseline';
  END IF;

  source_type_value := baseline_payload->>'source_type';
  plan_value := (baseline_payload->>'plan_id')::uuid;
  fiscal_year_value := (baseline_payload->>'fiscal_year_id')::uuid;

  IF source_type_value NOT IN ('layer1_handoff', 'manual') THEN
    RAISE EXCEPTION 'Invalid budget baseline source type';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.plans WHERE organisation_id = target_organisation_id AND id = plan_value) THEN
    RAISE EXCEPTION 'Plan not found for organisation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.fiscal_years WHERE organisation_id = target_organisation_id AND plan_id = plan_value AND id = fiscal_year_value) THEN
    RAISE EXCEPTION 'Fiscal year not found for organisation and plan';
  END IF;

  IF source_type_value = 'layer1_handoff' THEN
    SELECT * INTO source_handoff
    FROM public.layer1_handoff_objects
    WHERE organisation_id = target_organisation_id
      AND plan_id = plan_value
      AND id = (baseline_payload->>'source_layer1_handoff_id')::uuid
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Layer 1 handoff not found for organisation and plan';
    END IF;
    IF source_handoff.handoff_status <> 'ready_for_layer2' THEN
      RAISE EXCEPTION 'Only ready_for_layer2 Layer 1 handoffs can create a budget baseline';
    END IF;
    IF source_handoff.version_lock_id IS DISTINCT FROM (baseline_payload->>'source_layer1_version_lock_id')::uuid THEN
      RAISE EXCEPTION 'Layer 1 handoff version lock does not match baseline source';
    END IF;
  END IF;

  INSERT INTO public.budget_baselines (
    organisation_id,
    plan_id,
    fiscal_year_id,
    baseline_name,
    baseline_type,
    source_type,
    source_layer1_handoff_id,
    source_layer1_version_lock_id,
    annual_budget_amount,
    annual_required_fte,
    annual_workload_hours,
    annual_labour_cost,
    annual_supply_gap_fte,
    source_quality_score,
    confidence_score,
    key_assumptions_json,
    risk_summary_json,
    scenario_summary_json,
    annualisation_note,
    status,
    notes,
    created_by
  ) VALUES (
    target_organisation_id,
    plan_value,
    fiscal_year_value,
    baseline_payload->>'baseline_name',
    COALESCE(baseline_payload->>'baseline_type', 'annual_labour_opex'),
    source_type_value,
    NULLIF(baseline_payload->>'source_layer1_handoff_id', '')::uuid,
    NULLIF(baseline_payload->>'source_layer1_version_lock_id', '')::uuid,
    COALESCE(NULLIF(baseline_payload->>'annual_budget_amount', '')::numeric, 0),
    COALESCE(NULLIF(baseline_payload->>'annual_required_fte', '')::numeric, 0),
    COALESCE(NULLIF(baseline_payload->>'annual_workload_hours', '')::numeric, 0),
    COALESCE(NULLIF(baseline_payload->>'annual_labour_cost', '')::numeric, 0),
    COALESCE(NULLIF(baseline_payload->>'annual_supply_gap_fte', '')::numeric, 0),
    NULLIF(baseline_payload->>'source_quality_score', '')::numeric,
    NULLIF(baseline_payload->>'confidence_score', '')::numeric,
    COALESCE(baseline_payload->'key_assumptions_json', '{}'::jsonb),
    COALESCE(baseline_payload->'risk_summary_json', '[]'::jsonb),
    COALESCE(baseline_payload->'scenario_summary_json', '[]'::jsonb),
    baseline_payload->>'annualisation_note',
    'draft',
    baseline_payload->>'notes',
    target_actor_user_id
  ) RETURNING * INTO new_baseline;

  FOR line_item IN SELECT * FROM jsonb_array_elements(line_payloads)
  LOOP
    INSERT INTO public.budget_baseline_lines (
      organisation_id,
      budget_baseline_id,
      plan_id,
      fiscal_year_id,
      period_id,
      period_start,
      period_end,
      workload_hours,
      required_fte,
      supply_gap_fte,
      labour_cost,
      budget_amount,
      phasing_method,
      source_category,
      notes,
      created_by
    ) VALUES (
      target_organisation_id,
      new_baseline.id,
      plan_value,
      fiscal_year_value,
      (line_item->>'period_id')::uuid,
      (line_item->>'period_start')::date,
      (line_item->>'period_end')::date,
      COALESCE(NULLIF(line_item->>'workload_hours', '')::numeric, 0),
      COALESCE(NULLIF(line_item->>'required_fte', '')::numeric, 0),
      COALESCE(NULLIF(line_item->>'supply_gap_fte', '')::numeric, 0),
      COALESCE(NULLIF(line_item->>'labour_cost', '')::numeric, 0),
      COALESCE(NULLIF(line_item->>'budget_amount', '')::numeric, 0),
      COALESCE(line_item->>'phasing_method', 'straight_line'),
      COALESCE(line_item->>'source_category', source_type_value),
      line_item->>'notes',
      target_actor_user_id
    );
  END LOOP;

  SELECT COALESCE(jsonb_agg(to_jsonb(line_rows) ORDER BY line_rows.period_start), '[]'::jsonb)
  INTO inserted_lines
  FROM public.budget_baseline_lines line_rows
  WHERE line_rows.organisation_id = target_organisation_id
    AND line_rows.budget_baseline_id = new_baseline.id;

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    new_value_json, reason
  ) VALUES (
    target_organisation_id,
    target_actor_user_id,
    CASE WHEN source_type_value = 'layer1_handoff' THEN 'budget_baseline.created_from_layer1_handoff' ELSE 'budget_baseline.manual_created' END,
    'budget_baseline',
    new_baseline.id,
    new_baseline.plan_id,
    new_baseline.fiscal_year_id,
    jsonb_build_object('baseline', to_jsonb(new_baseline), 'line_count', jsonb_array_length(inserted_lines)),
    COALESCE(create_reason, 'Budget baseline draft created')
  );

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    new_value_json, reason
  ) VALUES (
    target_organisation_id,
    target_actor_user_id,
    'budget_baseline.phasing_generated',
    'budget_baseline',
    new_baseline.id,
    new_baseline.plan_id,
    new_baseline.fiscal_year_id,
    inserted_lines,
    'Monthly baseline phasing generated'
  );

  IF source_type_value = 'layer1_handoff' THEN
    PERFORM public.transition_layer1_handoff_status_controlled(
      target_organisation_id,
      plan_value,
      source_handoff.id,
      target_actor_user_id,
      'imported_to_baseline',
      'Layer 1 handoff imported into budget baseline ' || new_baseline.id::text
    );
  END IF;

  RETURN jsonb_build_object('baseline', to_jsonb(new_baseline), 'lines', inserted_lines);
END;
$$;

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
  -- UAT hardening: SECURITY DEFINER governance RPCs accept a target actor id,
  -- so they must be executable by the server-side service role only.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'This RPC may only be executed by the service role';
  END IF;

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

CREATE OR REPLACE FUNCTION public.create_forecast_driver(
  target_organisation_id uuid,
  target_actor_user_id uuid,
  driver_payload jsonb,
  line_payloads jsonb,
  create_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_baseline public.budget_baselines%ROWTYPE;
  new_driver public.forecast_drivers%ROWTYPE;
  next_code_number integer;
BEGIN
  -- UAT hardening: SECURITY DEFINER governance RPCs accept a target actor id,
  -- so they must be executable by the server-side service role only.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'This RPC may only be executed by the service role';
  END IF;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin', 'planner']) THEN
    RAISE EXCEPTION 'Insufficient permission to create forecast drivers';
  END IF;

  SELECT * INTO target_baseline
  FROM public.budget_baselines
  WHERE organisation_id = target_organisation_id
    AND id = (driver_payload->>'budget_baseline_id')::uuid
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget baseline not found for organisation';
  END IF;

  IF target_baseline.status <> 'locked' THEN
    RAISE EXCEPTION 'Forecast drivers can only be registered against a locked budget baseline';
  END IF;

  PERFORM public.assert_forecast_driver_lines_reconcile((driver_payload->>'annual_impact_amount')::numeric, line_payloads);

  -- Serialise driver code generation per organisation, plan and fiscal year.
  PERFORM pg_advisory_xact_lock(hashtext(target_organisation_id::text || ':' || target_baseline.plan_id::text || ':' || target_baseline.fiscal_year_id::text || ':driver_code'));

  SELECT COALESCE(COUNT(*), 0) + 1 INTO next_code_number
  FROM public.forecast_drivers
  WHERE organisation_id = target_organisation_id
    AND plan_id = target_baseline.plan_id
    AND fiscal_year_id = target_baseline.fiscal_year_id;

  INSERT INTO public.forecast_drivers (
    organisation_id, plan_id, fiscal_year_id, budget_baseline_id,
    driver_code, driver_name, category, impact_type, annual_impact_amount,
    phasing_model, start_period_id, end_period_id, one_off_period_id,
    owner_user_id, confidence_rating, commentary, status, supersedes_driver_id, created_by
  ) VALUES (
    target_organisation_id,
    target_baseline.plan_id,
    target_baseline.fiscal_year_id,
    target_baseline.id,
    'DRV-' || lpad(next_code_number::text, 4, '0'),
    driver_payload->>'driver_name',
    driver_payload->>'category',
    driver_payload->>'impact_type',
    (driver_payload->>'annual_impact_amount')::numeric,
    driver_payload->>'phasing_model',
    (driver_payload->>'start_period_id')::uuid,
    (driver_payload->>'end_period_id')::uuid,
    NULLIF(driver_payload->>'one_off_period_id', '')::uuid,
    COALESCE(NULLIF(driver_payload->>'owner_user_id', '')::uuid, target_actor_user_id),
    COALESCE(NULLIF(driver_payload->>'confidence_rating', ''), 'medium'),
    NULLIF(driver_payload->>'commentary', ''),
    'draft',
    NULLIF(driver_payload->>'supersedes_driver_id', '')::uuid,
    target_actor_user_id
  )
  RETURNING * INTO new_driver;

  PERFORM public.insert_forecast_driver_lines(target_organisation_id, new_driver, line_payloads);

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'driver.created', 'forecast_driver', new_driver.id,
    new_driver.plan_id, new_driver.fiscal_year_id,
    NULL,
    jsonb_build_object(
      'driver_code', new_driver.driver_code,
      'driver_name', new_driver.driver_name,
      'category', new_driver.category,
      'impact_type', new_driver.impact_type,
      'annual_impact_amount', new_driver.annual_impact_amount,
      'phasing_model', new_driver.phasing_model,
      'status', new_driver.status
    ),
    COALESCE(create_reason, 'Forecast driver registered as draft')
  );

  RETURN to_jsonb(new_driver);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_forecast_driver_draft(
  target_organisation_id uuid,
  target_actor_user_id uuid,
  target_driver_id uuid,
  driver_payload jsonb,
  line_payloads jsonb,
  update_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_driver public.forecast_drivers%ROWTYPE;
  updated_driver public.forecast_drivers%ROWTYPE;
BEGIN
  -- UAT hardening: SECURITY DEFINER governance RPCs accept a target actor id,
  -- so they must be executable by the server-side service role only.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'This RPC may only be executed by the service role';
  END IF;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin', 'planner']) THEN
    RAISE EXCEPTION 'Insufficient permission to update forecast drivers';
  END IF;

  SELECT * INTO current_driver
  FROM public.forecast_drivers
  WHERE organisation_id = target_organisation_id AND id = target_driver_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forecast driver not found for organisation';
  END IF;

  IF current_driver.status NOT IN ('draft', 'proposed') THEN
    RAISE EXCEPTION 'Only draft or proposed forecast drivers can be edited';
  END IF;

  PERFORM public.assert_forecast_driver_lines_reconcile((driver_payload->>'annual_impact_amount')::numeric, line_payloads);

  UPDATE public.forecast_drivers
  SET driver_name = COALESCE(driver_payload->>'driver_name', driver_name),
      category = COALESCE(driver_payload->>'category', category),
      impact_type = COALESCE(driver_payload->>'impact_type', impact_type),
      annual_impact_amount = COALESCE((driver_payload->>'annual_impact_amount')::numeric, annual_impact_amount),
      phasing_model = COALESCE(driver_payload->>'phasing_model', phasing_model),
      start_period_id = COALESCE((driver_payload->>'start_period_id')::uuid, start_period_id),
      end_period_id = COALESCE((driver_payload->>'end_period_id')::uuid, end_period_id),
      one_off_period_id = NULLIF(driver_payload->>'one_off_period_id', '')::uuid,
      confidence_rating = COALESCE(NULLIF(driver_payload->>'confidence_rating', ''), confidence_rating),
      commentary = COALESCE(NULLIF(driver_payload->>'commentary', ''), commentary)
  WHERE organisation_id = target_organisation_id AND id = target_driver_id
  RETURNING * INTO updated_driver;

  DELETE FROM public.forecast_driver_lines
  WHERE organisation_id = target_organisation_id AND forecast_driver_id = target_driver_id;

  PERFORM public.insert_forecast_driver_lines(target_organisation_id, updated_driver, line_payloads);

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'driver.updated', 'forecast_driver', updated_driver.id,
    updated_driver.plan_id, updated_driver.fiscal_year_id,
    jsonb_build_object(
      'driver_name', current_driver.driver_name,
      'category', current_driver.category,
      'impact_type', current_driver.impact_type,
      'annual_impact_amount', current_driver.annual_impact_amount,
      'phasing_model', current_driver.phasing_model
    ),
    jsonb_build_object(
      'driver_name', updated_driver.driver_name,
      'category', updated_driver.category,
      'impact_type', updated_driver.impact_type,
      'annual_impact_amount', updated_driver.annual_impact_amount,
      'phasing_model', updated_driver.phasing_model
    ),
    COALESCE(update_reason, 'Forecast driver draft updated')
  );

  RETURN to_jsonb(updated_driver);
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_forecast_driver_status(
  target_organisation_id uuid,
  target_actor_user_id uuid,
  target_driver_id uuid,
  next_status text,
  transition_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_driver public.forecast_drivers%ROWTYPE;
  updated_driver public.forecast_drivers%ROWTYPE;
  allowed_roles text[];
  transition_allowed boolean := false;
  event_name text;
BEGIN
  -- UAT hardening: SECURITY DEFINER governance RPCs accept a target actor id,
  -- so they must be executable by the server-side service role only.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'This RPC may only be executed by the service role';
  END IF;

  SELECT * INTO current_driver
  FROM public.forecast_drivers
  WHERE organisation_id = target_organisation_id AND id = target_driver_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forecast driver not found for organisation';
  END IF;

  IF next_status = 'proposed' AND current_driver.status = 'draft' THEN
    transition_allowed := true;
    allowed_roles := ARRAY['owner', 'admin', 'finance_admin', 'planner'];
    event_name := 'driver.proposed';
  ELSIF next_status = 'draft' AND current_driver.status = 'proposed' THEN
    transition_allowed := true;
    allowed_roles := ARRAY['owner', 'admin', 'finance_admin', 'planner'];
    event_name := 'driver.reverted_to_draft';
  ELSIF next_status = 'approved' AND current_driver.status = 'proposed' THEN
    transition_allowed := true;
    allowed_roles := ARRAY['owner', 'admin', 'finance_admin', 'reviewer'];
    event_name := 'driver.approved';
  ELSIF next_status = 'voided' AND current_driver.status IN ('draft', 'proposed') THEN
    transition_allowed := true;
    allowed_roles := ARRAY['owner', 'admin', 'finance_admin'];
    event_name := 'driver.voided';
  END IF;

  IF NOT transition_allowed THEN
    RAISE EXCEPTION 'Forecast driver transition from % to % is not permitted', current_driver.status, next_status;
  END IF;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, allowed_roles) THEN
    RAISE EXCEPTION 'Insufficient permission for forecast driver transition to %', next_status;
  END IF;

  IF next_status = 'approved' THEN
    -- Lock phased lines first while the parent is still in a mutable state.
    UPDATE public.forecast_driver_lines
    SET is_immutable = true
    WHERE organisation_id = target_organisation_id AND forecast_driver_id = target_driver_id;
  END IF;

  UPDATE public.forecast_drivers
  SET status = next_status,
      proposed_by = CASE WHEN next_status = 'proposed' THEN target_actor_user_id ELSE proposed_by END,
      proposed_at = CASE WHEN next_status = 'proposed' THEN now() ELSE proposed_at END,
      approved_by = CASE WHEN next_status = 'approved' THEN target_actor_user_id ELSE approved_by END,
      approved_at = CASE WHEN next_status = 'approved' THEN now() ELSE approved_at END,
      is_immutable = CASE WHEN next_status = 'approved' THEN true ELSE is_immutable END
  WHERE organisation_id = target_organisation_id AND id = target_driver_id
  RETURNING * INTO updated_driver;

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, event_name, 'forecast_driver', updated_driver.id,
    updated_driver.plan_id, updated_driver.fiscal_year_id,
    jsonb_build_object('status', current_driver.status),
    jsonb_build_object('status', updated_driver.status),
    COALESCE(transition_reason, 'Forecast driver status transition')
  );

  RETURN to_jsonb(updated_driver);
END;
$$;

CREATE OR REPLACE FUNCTION public.supersede_forecast_driver(
  target_organisation_id uuid,
  target_actor_user_id uuid,
  target_driver_id uuid,
  replacement_payload jsonb,
  replacement_lines jsonb,
  supersede_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_driver public.forecast_drivers%ROWTYPE;
  replacement_driver jsonb;
  replacement_driver_id uuid;
BEGIN
  -- UAT hardening: SECURITY DEFINER governance RPCs accept a target actor id,
  -- so they must be executable by the server-side service role only.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'This RPC may only be executed by the service role';
  END IF;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin']) THEN
    RAISE EXCEPTION 'Insufficient permission to supersede forecast drivers';
  END IF;

  SELECT * INTO current_driver
  FROM public.forecast_drivers
  WHERE organisation_id = target_organisation_id AND id = target_driver_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forecast driver not found for organisation';
  END IF;

  IF current_driver.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved forecast drivers can be superseded';
  END IF;

  replacement_driver := public.create_forecast_driver(
    target_organisation_id,
    target_actor_user_id,
    replacement_payload || jsonb_build_object(
      'budget_baseline_id', current_driver.budget_baseline_id::text,
      'supersedes_driver_id', target_driver_id::text
    ),
    replacement_lines,
    COALESCE(supersede_reason, 'Replacement draft created to supersede ' || current_driver.driver_code)
  );

  replacement_driver_id := (replacement_driver->>'id')::uuid;

  UPDATE public.forecast_drivers
  SET status = 'superseded',
      superseded_by_driver_id = replacement_driver_id
  WHERE organisation_id = target_organisation_id AND id = target_driver_id;

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'driver.superseded', 'forecast_driver', target_driver_id,
    current_driver.plan_id, current_driver.fiscal_year_id,
    jsonb_build_object('status', 'approved'),
    jsonb_build_object('status', 'superseded', 'superseded_by_driver_id', replacement_driver_id),
    COALESCE(supersede_reason, 'Approved forecast driver superseded by controlled replacement')
  );

  RETURN replacement_driver;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_reforecast(
  target_organisation_id uuid,
  target_actor_user_id uuid,
  reforecast_payload jsonb,
  line_payloads jsonb,
  impact_payloads jsonb,
  create_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_baseline public.budget_baselines%ROWTYPE;
  new_reforecast public.reforecasts%ROWTYPE;
  next_code_number integer;
  impact_count integer;
BEGIN
  -- UAT hardening: SECURITY DEFINER governance RPCs accept a target actor id,
  -- so they must be executable by the server-side service role only.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'This RPC may only be executed by the service role';
  END IF;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin', 'planner']) THEN
    RAISE EXCEPTION 'Insufficient permission to create reforecasts';
  END IF;

  SELECT * INTO target_baseline
  FROM public.budget_baselines
  WHERE organisation_id = target_organisation_id
    AND id = (reforecast_payload->>'budget_baseline_id')::uuid
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget baseline not found for organisation';
  END IF;

  IF target_baseline.status <> 'locked' THEN
    RAISE EXCEPTION 'Reforecasts can only be created from a locked budget baseline';
  END IF;

  PERFORM public.assert_reforecast_lines_consistent(line_payloads);

  PERFORM pg_advisory_xact_lock(hashtext(target_organisation_id::text || ':' || target_baseline.plan_id::text || ':' || target_baseline.fiscal_year_id::text || ':reforecast_code'));

  SELECT COALESCE(COUNT(*), 0) + 1 INTO next_code_number
  FROM public.reforecasts
  WHERE organisation_id = target_organisation_id
    AND plan_id = target_baseline.plan_id
    AND fiscal_year_id = target_baseline.fiscal_year_id;

  INSERT INTO public.reforecasts (
    organisation_id, plan_id, fiscal_year_id, budget_baseline_id,
    reforecast_code, reforecast_name, status, calculated_at, calculation_checksum, created_by
  ) VALUES (
    target_organisation_id,
    target_baseline.plan_id,
    target_baseline.fiscal_year_id,
    target_baseline.id,
    'RFC-' || lpad(next_code_number::text, 4, '0'),
    reforecast_payload->>'reforecast_name',
    'draft',
    now(),
    reforecast_payload->>'calculation_checksum',
    target_actor_user_id
  )
  RETURNING * INTO new_reforecast;

  PERFORM public.insert_reforecast_lines(target_organisation_id, new_reforecast, line_payloads);
  impact_count := public.insert_reforecast_driver_impacts(target_organisation_id, new_reforecast, impact_payloads);

  UPDATE public.reforecasts
  SET approved_driver_count = impact_count
  WHERE organisation_id = target_organisation_id AND id = new_reforecast.id
  RETURNING * INTO new_reforecast;

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'reforecast.created', 'reforecast', new_reforecast.id,
    new_reforecast.plan_id, new_reforecast.fiscal_year_id,
    NULL,
    jsonb_build_object(
      'reforecast_code', new_reforecast.reforecast_code,
      'reforecast_name', new_reforecast.reforecast_name,
      'budget_baseline_id', new_reforecast.budget_baseline_id,
      'approved_driver_count', new_reforecast.approved_driver_count,
      'calculation_checksum', new_reforecast.calculation_checksum,
      'status', new_reforecast.status
    ),
    COALESCE(create_reason, 'Draft reforecast created from locked budget baseline and approved drivers')
  );

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'reforecast.driver_inclusion_snapshot_created', 'reforecast', new_reforecast.id,
    new_reforecast.plan_id, new_reforecast.fiscal_year_id,
    NULL,
    jsonb_build_object('approved_driver_count', impact_count),
    'Approved driver inclusion snapshot recorded for working forecast'
  );

  RETURN to_jsonb(new_reforecast);
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_reforecast(
  target_organisation_id uuid,
  target_actor_user_id uuid,
  target_reforecast_id uuid,
  reforecast_payload jsonb,
  line_payloads jsonb,
  impact_payloads jsonb,
  recalculate_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_reforecast public.reforecasts%ROWTYPE;
  updated_reforecast public.reforecasts%ROWTYPE;
  impact_count integer;
BEGIN
  -- UAT hardening: SECURITY DEFINER governance RPCs accept a target actor id,
  -- so they must be executable by the server-side service role only.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'This RPC may only be executed by the service role';
  END IF;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin', 'planner']) THEN
    RAISE EXCEPTION 'Insufficient permission to recalculate reforecasts';
  END IF;

  SELECT * INTO current_reforecast
  FROM public.reforecasts
  WHERE organisation_id = target_organisation_id AND id = target_reforecast_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reforecast not found for organisation';
  END IF;

  IF current_reforecast.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft reforecasts can be recalculated';
  END IF;

  PERFORM public.assert_reforecast_lines_consistent(line_payloads);

  DELETE FROM public.reforecast_lines
  WHERE organisation_id = target_organisation_id AND reforecast_id = target_reforecast_id;
  DELETE FROM public.reforecast_driver_impacts
  WHERE organisation_id = target_organisation_id AND reforecast_id = target_reforecast_id;

  PERFORM public.insert_reforecast_lines(target_organisation_id, current_reforecast, line_payloads);
  impact_count := public.insert_reforecast_driver_impacts(target_organisation_id, current_reforecast, impact_payloads);

  UPDATE public.reforecasts
  SET reforecast_name = COALESCE(reforecast_payload->>'reforecast_name', reforecast_name),
      calculated_at = now(),
      calculation_checksum = COALESCE(reforecast_payload->>'calculation_checksum', calculation_checksum),
      approved_driver_count = impact_count
  WHERE organisation_id = target_organisation_id AND id = target_reforecast_id
  RETURNING * INTO updated_reforecast;

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'reforecast.recalculated', 'reforecast', updated_reforecast.id,
    updated_reforecast.plan_id, updated_reforecast.fiscal_year_id,
    jsonb_build_object('calculation_checksum', current_reforecast.calculation_checksum, 'approved_driver_count', current_reforecast.approved_driver_count),
    jsonb_build_object('calculation_checksum', updated_reforecast.calculation_checksum, 'approved_driver_count', updated_reforecast.approved_driver_count),
    COALESCE(recalculate_reason, 'Working forecast recalculated from locked baseline and approved drivers')
  );

  RETURN to_jsonb(updated_reforecast);
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_reforecast_status(
  target_organisation_id uuid,
  target_actor_user_id uuid,
  target_reforecast_id uuid,
  next_status text,
  transition_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_reforecast public.reforecasts%ROWTYPE;
  updated_reforecast public.reforecasts%ROWTYPE;
  allowed_roles text[];
  transition_allowed boolean := false;
  event_name text;
BEGIN
  -- UAT hardening: SECURITY DEFINER governance RPCs accept a target actor id,
  -- so they must be executable by the server-side service role only.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'This RPC may only be executed by the service role';
  END IF;

  SELECT * INTO current_reforecast
  FROM public.reforecasts
  WHERE organisation_id = target_organisation_id AND id = target_reforecast_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reforecast not found for organisation';
  END IF;

  IF next_status = 'in_review' AND current_reforecast.status = 'draft' THEN
    transition_allowed := true;
    allowed_roles := ARRAY['owner', 'admin', 'finance_admin', 'planner'];
    event_name := 'reforecast.submitted_for_review';
  ELSIF next_status = 'draft' AND current_reforecast.status = 'in_review' THEN
    transition_allowed := true;
    allowed_roles := ARRAY['owner', 'admin', 'finance_admin', 'planner'];
    event_name := 'reforecast.reverted_to_draft';
  ELSIF next_status = 'voided' AND current_reforecast.status IN ('draft', 'in_review') THEN
    transition_allowed := true;
    allowed_roles := ARRAY['owner', 'admin', 'finance_admin'];
    event_name := 'reforecast.voided';
  ELSIF next_status = 'voided' AND current_reforecast.status = 'locked' THEN
    -- Admin-controlled voiding of a locked forecast: preserved for history,
    -- never the current valid forecast again.
    transition_allowed := true;
    allowed_roles := ARRAY['owner', 'admin'];
    event_name := 'reforecast.voided';
  END IF;

  IF NOT transition_allowed THEN
    RAISE EXCEPTION 'Reforecast transition from % to % is not permitted', current_reforecast.status, next_status;
  END IF;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, allowed_roles) THEN
    RAISE EXCEPTION 'Insufficient permission for reforecast transition to %', next_status;
  END IF;

  UPDATE public.reforecasts
  SET status = next_status,
      submitted_by = CASE WHEN next_status = 'in_review' THEN target_actor_user_id ELSE submitted_by END,
      submitted_at = CASE WHEN next_status = 'in_review' THEN now() ELSE submitted_at END,
      voided_by = CASE WHEN next_status = 'voided' THEN target_actor_user_id ELSE voided_by END,
      voided_at = CASE WHEN next_status = 'voided' THEN now() ELSE voided_at END,
      is_current_locked = CASE WHEN next_status = 'voided' THEN false ELSE is_current_locked END
  WHERE organisation_id = target_organisation_id AND id = target_reforecast_id
  RETURNING * INTO updated_reforecast;

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, event_name, 'reforecast', updated_reforecast.id,
    updated_reforecast.plan_id, updated_reforecast.fiscal_year_id,
    jsonb_build_object('status', current_reforecast.status, 'is_current_locked', current_reforecast.is_current_locked),
    jsonb_build_object('status', updated_reforecast.status, 'is_current_locked', updated_reforecast.is_current_locked),
    COALESCE(transition_reason, 'Reforecast status transition')
  );

  RETURN to_jsonb(updated_reforecast);
END;
$$;

CREATE OR REPLACE FUNCTION public.lock_reforecast(
  target_organisation_id uuid,
  target_actor_user_id uuid,
  target_reforecast_id uuid,
  snapshot_payload jsonb,
  lock_checksum text,
  lock_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_reforecast public.reforecasts%ROWTYPE;
  previous_current public.reforecasts%ROWTYPE;
  locked_reforecast public.reforecasts%ROWTYPE;
  new_lock_version_id text;
BEGIN
  -- UAT hardening: SECURITY DEFINER governance RPCs accept a target actor id,
  -- so they must be executable by the server-side service role only.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'This RPC may only be executed by the service role';
  END IF;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin']) THEN
    RAISE EXCEPTION 'Insufficient permission to lock reforecasts';
  END IF;

  IF lock_checksum IS NULL OR length(lock_checksum) < 16 THEN
    RAISE EXCEPTION 'A deterministic lock checksum is required to lock a reforecast';
  END IF;

  SELECT * INTO current_reforecast
  FROM public.reforecasts
  WHERE organisation_id = target_organisation_id AND id = target_reforecast_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reforecast not found for organisation';
  END IF;

  IF current_reforecast.status <> 'in_review' THEN
    RAISE EXCEPTION 'Only reforecasts in review can be locked';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(target_organisation_id::text || ':' || current_reforecast.budget_baseline_id::text || ':current_locked_reforecast'));

  -- Supersede the previous current locked forecast in the same baseline context.
  SELECT * INTO previous_current
  FROM public.reforecasts
  WHERE organisation_id = target_organisation_id
    AND budget_baseline_id = current_reforecast.budget_baseline_id
    AND is_current_locked = true
    AND id <> target_reforecast_id
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.reforecasts
    SET status = 'superseded',
        is_current_locked = false,
        superseded_by_reforecast_id = target_reforecast_id
    WHERE organisation_id = target_organisation_id AND id = previous_current.id;

    INSERT INTO public.audit_events (
      organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
      old_value_json, new_value_json, reason
    ) VALUES (
      target_organisation_id, target_actor_user_id, 'reforecast.superseded', 'reforecast', previous_current.id,
      previous_current.plan_id, previous_current.fiscal_year_id,
      jsonb_build_object('status', 'locked', 'is_current_locked', true),
      jsonb_build_object('status', 'superseded', 'is_current_locked', false, 'superseded_by_reforecast_id', target_reforecast_id),
      'Previous current locked forecast superseded by a newer forecast lock'
    );
  END IF;

  -- Freeze detail rows first while the parent is still in a mutable state.
  UPDATE public.reforecast_lines
  SET is_immutable = true
  WHERE organisation_id = target_organisation_id AND reforecast_id = target_reforecast_id;

  UPDATE public.reforecast_driver_impacts
  SET is_immutable = true
  WHERE organisation_id = target_organisation_id AND reforecast_id = target_reforecast_id;

  new_lock_version_id := 'RFL-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || left(target_reforecast_id::text, 8);

  UPDATE public.reforecasts
  SET status = 'locked',
      is_current_locked = true,
      is_immutable = true,
      locked_by = target_actor_user_id,
      locked_at = now(),
      lock_version_id = new_lock_version_id,
      checksum = lock_checksum,
      supersedes_reforecast_id = COALESCE(previous_current.id, supersedes_reforecast_id)
  WHERE organisation_id = target_organisation_id AND id = target_reforecast_id
  RETURNING * INTO locked_reforecast;

  INSERT INTO public.reforecast_snapshots (
    organisation_id, reforecast_id, snapshot_type, snapshot_json, checksum, created_by
  ) VALUES (
    target_organisation_id, target_reforecast_id, 'lock', snapshot_payload, lock_checksum, target_actor_user_id
  );

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'reforecast.locked', 'reforecast', locked_reforecast.id,
    locked_reforecast.plan_id, locked_reforecast.fiscal_year_id,
    jsonb_build_object('status', 'in_review'),
    jsonb_build_object('status', 'locked', 'is_current_locked', true, 'lock_version_id', new_lock_version_id, 'checksum', lock_checksum),
    COALESCE(lock_reason, 'Reforecast locked as the current valid forecast')
  );

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'reforecast.lock_snapshot_created', 'reforecast', locked_reforecast.id,
    locked_reforecast.plan_id, locked_reforecast.fiscal_year_id,
    NULL,
    jsonb_build_object('checksum', lock_checksum, 'lock_version_id', new_lock_version_id),
    'Immutable lock snapshot captured for forecast history'
  );

  RETURN to_jsonb(locked_reforecast);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_actuals_batch_draft(
  target_organisation_id uuid,
  target_actor_user_id uuid,
  target_batch_id uuid,
  batch_payload jsonb,
  line_payloads jsonb,
  update_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_batch public.actuals_batches%ROWTYPE;
  updated_batch public.actuals_batches%ROWTYPE;
BEGIN
  -- UAT hardening: SECURITY DEFINER governance RPCs accept a target actor id,
  -- so they must be executable by the server-side service role only.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'This RPC may only be executed by the service role';
  END IF;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin', 'planner']) THEN
    RAISE EXCEPTION 'Insufficient permission to update actuals batches';
  END IF;

  SELECT * INTO current_batch
  FROM public.actuals_batches
  WHERE organisation_id = target_organisation_id AND id = target_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Actuals batch not found for organisation';
  END IF;

  IF current_batch.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft actuals batches can be edited';
  END IF;

  PERFORM public.assert_actuals_lines_valid(target_organisation_id, current_batch.fiscal_year_id, line_payloads);

  DELETE FROM public.actuals_lines
  WHERE organisation_id = target_organisation_id AND actuals_batch_id = target_batch_id;

  PERFORM public.insert_actuals_lines(target_organisation_id, current_batch, line_payloads);

  UPDATE public.actuals_batches
  SET batch_name = COALESCE(batch_payload->>'batch_name', batch_name),
      checksum = COALESCE(batch_payload->>'checksum', checksum)
  WHERE organisation_id = target_organisation_id AND id = target_batch_id
  RETURNING * INTO updated_batch;

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'actuals.batch_updated', 'actuals_batch', updated_batch.id,
    updated_batch.plan_id, updated_batch.fiscal_year_id,
    jsonb_build_object('checksum', current_batch.checksum),
    jsonb_build_object('checksum', updated_batch.checksum),
    COALESCE(update_reason, 'Draft actuals batch updated')
  );

  RETURN to_jsonb(updated_batch);
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_actuals_batch_status(
  target_organisation_id uuid,
  target_actor_user_id uuid,
  target_batch_id uuid,
  next_status text,
  transition_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_batch public.actuals_batches%ROWTYPE;
  updated_batch public.actuals_batches%ROWTYPE;
  allowed_roles text[];
  transition_allowed boolean := false;
  event_name text;
BEGIN
  -- UAT hardening: SECURITY DEFINER governance RPCs accept a target actor id,
  -- so they must be executable by the server-side service role only.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'This RPC may only be executed by the service role';
  END IF;

  SELECT * INTO current_batch
  FROM public.actuals_batches
  WHERE organisation_id = target_organisation_id AND id = target_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Actuals batch not found for organisation';
  END IF;

  IF next_status = 'validated' AND current_batch.status = 'draft' THEN
    transition_allowed := true;
    allowed_roles := ARRAY['owner', 'admin', 'finance_admin', 'planner'];
    event_name := 'actuals.batch_validated';
  ELSIF next_status = 'draft' AND current_batch.status = 'validated' THEN
    transition_allowed := true;
    allowed_roles := ARRAY['owner', 'admin', 'finance_admin', 'planner'];
    event_name := 'actuals.batch_reverted_to_draft';
  ELSIF next_status = 'posted' AND current_batch.status = 'validated' THEN
    transition_allowed := true;
    allowed_roles := ARRAY['owner', 'admin', 'finance_admin'];
    event_name := 'actuals.batch_posted';
  ELSIF next_status = 'voided' AND current_batch.status IN ('draft', 'validated') THEN
    transition_allowed := true;
    allowed_roles := ARRAY['owner', 'admin', 'finance_admin'];
    event_name := 'actuals.batch_voided';
  ELSIF next_status = 'voided' AND current_batch.status = 'posted' THEN
    transition_allowed := true;
    allowed_roles := ARRAY['owner', 'admin'];
    event_name := 'actuals.batch_voided';
  END IF;

  IF NOT transition_allowed THEN
    RAISE EXCEPTION 'Actuals batch transition from % to % is not permitted', current_batch.status, next_status;
  END IF;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, allowed_roles) THEN
    RAISE EXCEPTION 'Insufficient permission for actuals transition to %', next_status;
  END IF;

  IF next_status = 'posted' THEN
    -- Posting freezes the rows: posted actuals are immutable.
    UPDATE public.actuals_lines
    SET is_immutable = true
    WHERE organisation_id = target_organisation_id AND actuals_batch_id = target_batch_id;
  END IF;

  UPDATE public.actuals_batches
  SET status = next_status,
      validated_by = CASE WHEN next_status = 'validated' THEN target_actor_user_id ELSE validated_by END,
      validated_at = CASE WHEN next_status = 'validated' THEN now() ELSE validated_at END,
      posted_by = CASE WHEN next_status = 'posted' THEN target_actor_user_id ELSE posted_by END,
      posted_at = CASE WHEN next_status = 'posted' THEN now() ELSE posted_at END,
      is_immutable = CASE WHEN next_status = 'posted' THEN true ELSE is_immutable END,
      voided_by = CASE WHEN next_status = 'voided' THEN target_actor_user_id ELSE voided_by END,
      voided_at = CASE WHEN next_status = 'voided' THEN now() ELSE voided_at END
  WHERE organisation_id = target_organisation_id AND id = target_batch_id
  RETURNING * INTO updated_batch;

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, event_name, 'actuals_batch', updated_batch.id,
    updated_batch.plan_id, updated_batch.fiscal_year_id,
    jsonb_build_object('status', current_batch.status),
    jsonb_build_object('status', updated_batch.status),
    COALESCE(transition_reason, 'Actuals batch status transition')
  );

  RETURN to_jsonb(updated_batch);
END;
$$;

CREATE OR REPLACE FUNCTION public.supersede_actuals_batch(
  target_organisation_id uuid,
  target_actor_user_id uuid,
  target_batch_id uuid,
  replacement_payload jsonb,
  replacement_lines jsonb,
  supersede_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_batch public.actuals_batches%ROWTYPE;
  replacement_batch public.actuals_batches%ROWTYPE;
  next_code_number integer;
BEGIN
  -- UAT hardening: SECURITY DEFINER governance RPCs accept a target actor id,
  -- so they must be executable by the server-side service role only.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'This RPC may only be executed by the service role';
  END IF;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin']) THEN
    RAISE EXCEPTION 'Insufficient permission to supersede actuals batches';
  END IF;

  SELECT * INTO current_batch
  FROM public.actuals_batches
  WHERE organisation_id = target_organisation_id AND id = target_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Actuals batch not found for organisation';
  END IF;

  IF current_batch.status <> 'posted' THEN
    RAISE EXCEPTION 'Only posted actuals batches can be superseded by a correction';
  END IF;

  PERFORM public.assert_actuals_lines_valid(target_organisation_id, current_batch.fiscal_year_id, replacement_lines);

  PERFORM pg_advisory_xact_lock(hashtext(target_organisation_id::text || ':' || current_batch.baseline_id::text || ':actuals_batch_code'));

  SELECT COALESCE(COUNT(*), 0) + 1 INTO next_code_number
  FROM public.actuals_batches
  WHERE organisation_id = target_organisation_id
    AND plan_id = current_batch.plan_id
    AND fiscal_year_id = current_batch.fiscal_year_id;

  -- The correction batch is created already posted: it atomically replaces the
  -- previous version as the latest posted actuals.
  INSERT INTO public.actuals_batches (
    organisation_id, plan_id, fiscal_year_id, baseline_id, reforecast_id,
    batch_code, batch_name, version_number, status, source_type,
    uploaded_by, posted_by, posted_at, supersedes_batch_id, checksum, is_immutable, created_by
  ) VALUES (
    target_organisation_id,
    current_batch.plan_id,
    current_batch.fiscal_year_id,
    current_batch.baseline_id,
    current_batch.reforecast_id,
    'ACT-' || lpad(next_code_number::text, 4, '0'),
    COALESCE(replacement_payload->>'batch_name', current_batch.batch_name || ' (correction)'),
    current_batch.version_number + 1,
    'posted',
    COALESCE(replacement_payload->>'source_type', current_batch.source_type),
    target_actor_user_id,
    target_actor_user_id,
    now(),
    current_batch.id,
    replacement_payload->>'checksum',
    true,
    target_actor_user_id
  )
  RETURNING * INTO replacement_batch;

  PERFORM public.insert_actuals_lines(target_organisation_id, replacement_batch, replacement_lines);

  UPDATE public.actuals_lines
  SET is_immutable = true
  WHERE organisation_id = target_organisation_id AND actuals_batch_id = replacement_batch.id;

  UPDATE public.actuals_batches
  SET status = 'superseded',
      superseded_by_batch_id = replacement_batch.id
  WHERE organisation_id = target_organisation_id AND id = current_batch.id;

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'actuals.batch_superseded', 'actuals_batch', current_batch.id,
    current_batch.plan_id, current_batch.fiscal_year_id,
    jsonb_build_object('status', 'posted', 'version_number', current_batch.version_number),
    jsonb_build_object('status', 'superseded', 'superseded_by_batch_id', replacement_batch.id),
    COALESCE(supersede_reason, 'Posted actuals corrected by a new version')
  );

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'actuals.correction_batch_posted', 'actuals_batch', replacement_batch.id,
    replacement_batch.plan_id, replacement_batch.fiscal_year_id,
    NULL,
    jsonb_build_object('batch_code', replacement_batch.batch_code, 'version_number', replacement_batch.version_number, 'supersedes_batch_id', current_batch.id, 'checksum', replacement_batch.checksum),
    COALESCE(supersede_reason, 'Correction batch posted')
  );

  RETURN to_jsonb(replacement_batch);
END;
$$;

CREATE OR REPLACE FUNCTION public.lock_variance_report(
  target_organisation_id uuid,
  target_actor_user_id uuid,
  target_report_id uuid,
  lock_checksum text,
  lock_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_report public.variance_reports%ROWTYPE;
  previous_current public.variance_reports%ROWTYPE;
  locked_report public.variance_reports%ROWTYPE;
  new_lock_version_id text;
BEGIN
  -- UAT hardening: SECURITY DEFINER governance RPCs accept a target actor id,
  -- so they must be executable by the server-side service role only.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'This RPC may only be executed by the service role';
  END IF;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin']) THEN
    RAISE EXCEPTION 'Insufficient permission to lock variance reports';
  END IF;

  IF lock_checksum IS NULL OR length(lock_checksum) < 16 THEN
    RAISE EXCEPTION 'A deterministic lock checksum is required to lock a variance report';
  END IF;

  SELECT * INTO current_report
  FROM public.variance_reports
  WHERE organisation_id = target_organisation_id AND id = target_report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variance report not found for organisation';
  END IF;

  IF current_report.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft variance reports can be locked';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(target_organisation_id::text || ':' || current_report.baseline_id::text || ':' || current_report.reforecast_id::text || ':current_locked_variance'));

  SELECT * INTO previous_current
  FROM public.variance_reports
  WHERE organisation_id = target_organisation_id
    AND baseline_id = current_report.baseline_id
    AND reforecast_id = current_report.reforecast_id
    AND is_current_locked = true
    AND id <> target_report_id
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.variance_reports
    SET status = 'superseded',
        is_current_locked = false,
        superseded_by_variance_id = target_report_id
    WHERE organisation_id = target_organisation_id AND id = previous_current.id;

    INSERT INTO public.audit_events (
      organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
      old_value_json, new_value_json, reason
    ) VALUES (
      target_organisation_id, target_actor_user_id, 'variance.report_superseded', 'variance_report', previous_current.id,
      previous_current.plan_id, previous_current.fiscal_year_id,
      jsonb_build_object('status', 'locked', 'is_current_locked', true),
      jsonb_build_object('status', 'superseded', 'is_current_locked', false, 'superseded_by_variance_id', target_report_id),
      'Previous current variance report superseded by a newer lock'
    );
  END IF;

  UPDATE public.variance_lines
  SET is_immutable = true
  WHERE organisation_id = target_organisation_id AND variance_report_id = target_report_id;

  new_lock_version_id := 'VARL-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || left(target_report_id::text, 8);

  UPDATE public.variance_reports
  SET status = 'locked',
      is_current_locked = true,
      is_immutable = true,
      locked_by = target_actor_user_id,
      locked_at = now(),
      lock_version_id = new_lock_version_id,
      checksum = lock_checksum
  WHERE organisation_id = target_organisation_id AND id = target_report_id
  RETURNING * INTO locked_report;

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'variance.report_locked', 'variance_report', locked_report.id,
    locked_report.plan_id, locked_report.fiscal_year_id,
    jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'locked', 'is_current_locked', true, 'lock_version_id', new_lock_version_id, 'checksum', lock_checksum),
    COALESCE(lock_reason, 'Variance report locked')
  );

  RETURN to_jsonb(locked_report);
END;
$$;

CREATE OR REPLACE FUNCTION public.void_variance_report(
  target_organisation_id uuid,
  target_actor_user_id uuid,
  target_report_id uuid,
  void_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_report public.variance_reports%ROWTYPE;
  updated_report public.variance_reports%ROWTYPE;
  allowed_roles text[];
BEGIN
  -- UAT hardening: SECURITY DEFINER governance RPCs accept a target actor id,
  -- so they must be executable by the server-side service role only.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'This RPC may only be executed by the service role';
  END IF;

  SELECT * INTO current_report
  FROM public.variance_reports
  WHERE organisation_id = target_organisation_id AND id = target_report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variance report not found for organisation';
  END IF;

  IF current_report.status = 'draft' THEN
    allowed_roles := ARRAY['owner', 'admin', 'finance_admin'];
  ELSIF current_report.status = 'locked' THEN
    allowed_roles := ARRAY['owner', 'admin'];
  ELSE
    RAISE EXCEPTION 'Variance report in status % cannot be voided', current_report.status;
  END IF;

  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, allowed_roles) THEN
    RAISE EXCEPTION 'Insufficient permission to void variance reports';
  END IF;

  UPDATE public.variance_reports
  SET status = 'voided',
      is_current_locked = false,
      voided_by = target_actor_user_id,
      voided_at = now()
  WHERE organisation_id = target_organisation_id AND id = target_report_id
  RETURNING * INTO updated_report;

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'variance.report_voided', 'variance_report', updated_report.id,
    updated_report.plan_id, updated_report.fiscal_year_id,
    jsonb_build_object('status', current_report.status, 'is_current_locked', current_report.is_current_locked),
    jsonb_build_object('status', 'voided', 'is_current_locked', false),
    COALESCE(void_reason, 'Variance report voided under admin control')
  );

  RETURN to_jsonb(updated_report);
END;
$$;

-- ---------------------------------------------------------------------------
-- Privilege hardening: Postgres grants EXECUTE on functions to PUBLIC by
-- default. Every service-role-only governance RPC and internal helper is now
-- explicitly revoked from PUBLIC, anon and authenticated. Internal helpers
-- run inside SECURITY DEFINER RPCs and receive no client grants at all.
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.create_layer1_lock_and_handoff(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_layer1_lock_and_handoff(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_layer1_lock_and_handoff(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_layer1_lock_and_handoff(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.transition_layer1_handoff_status_controlled(uuid, uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transition_layer1_handoff_status_controlled(uuid, uuid, uuid, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.transition_layer1_handoff_status_controlled(uuid, uuid, uuid, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.transition_layer1_handoff_status_controlled(uuid, uuid, uuid, uuid, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_budget_baseline_draft(uuid, uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_budget_baseline_draft(uuid, uuid, jsonb, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_budget_baseline_draft(uuid, uuid, jsonb, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_budget_baseline_draft(uuid, uuid, jsonb, jsonb, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.lock_budget_baseline(uuid, uuid, uuid, uuid, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lock_budget_baseline(uuid, uuid, uuid, uuid, uuid, jsonb, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.lock_budget_baseline(uuid, uuid, uuid, uuid, uuid, jsonb, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lock_budget_baseline(uuid, uuid, uuid, uuid, uuid, jsonb, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_forecast_driver(uuid, uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_forecast_driver(uuid, uuid, jsonb, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_forecast_driver(uuid, uuid, jsonb, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_forecast_driver(uuid, uuid, jsonb, jsonb, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_forecast_driver_draft(uuid, uuid, uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_forecast_driver_draft(uuid, uuid, uuid, jsonb, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_forecast_driver_draft(uuid, uuid, uuid, jsonb, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_forecast_driver_draft(uuid, uuid, uuid, jsonb, jsonb, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.transition_forecast_driver_status(uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transition_forecast_driver_status(uuid, uuid, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.transition_forecast_driver_status(uuid, uuid, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.transition_forecast_driver_status(uuid, uuid, uuid, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.supersede_forecast_driver(uuid, uuid, uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.supersede_forecast_driver(uuid, uuid, uuid, jsonb, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.supersede_forecast_driver(uuid, uuid, uuid, jsonb, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_forecast_driver(uuid, uuid, uuid, jsonb, jsonb, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_reforecast(uuid, uuid, jsonb, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_reforecast(uuid, uuid, jsonb, jsonb, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_reforecast(uuid, uuid, jsonb, jsonb, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_reforecast(uuid, uuid, jsonb, jsonb, jsonb, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.recalculate_reforecast(uuid, uuid, uuid, jsonb, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recalculate_reforecast(uuid, uuid, uuid, jsonb, jsonb, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recalculate_reforecast(uuid, uuid, uuid, jsonb, jsonb, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_reforecast(uuid, uuid, uuid, jsonb, jsonb, jsonb, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.transition_reforecast_status(uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transition_reforecast_status(uuid, uuid, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.transition_reforecast_status(uuid, uuid, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.transition_reforecast_status(uuid, uuid, uuid, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.lock_reforecast(uuid, uuid, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lock_reforecast(uuid, uuid, uuid, jsonb, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.lock_reforecast(uuid, uuid, uuid, jsonb, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lock_reforecast(uuid, uuid, uuid, jsonb, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_actuals_batch(uuid, uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_actuals_batch(uuid, uuid, jsonb, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_actuals_batch(uuid, uuid, jsonb, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_actuals_batch(uuid, uuid, jsonb, jsonb, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_actuals_batch_draft(uuid, uuid, uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_actuals_batch_draft(uuid, uuid, uuid, jsonb, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_actuals_batch_draft(uuid, uuid, uuid, jsonb, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_actuals_batch_draft(uuid, uuid, uuid, jsonb, jsonb, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.transition_actuals_batch_status(uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transition_actuals_batch_status(uuid, uuid, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.transition_actuals_batch_status(uuid, uuid, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.transition_actuals_batch_status(uuid, uuid, uuid, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.supersede_actuals_batch(uuid, uuid, uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.supersede_actuals_batch(uuid, uuid, uuid, jsonb, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.supersede_actuals_batch(uuid, uuid, uuid, jsonb, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_actuals_batch(uuid, uuid, uuid, jsonb, jsonb, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_variance_report(uuid, uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_variance_report(uuid, uuid, jsonb, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_variance_report(uuid, uuid, jsonb, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_variance_report(uuid, uuid, jsonb, jsonb, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.recalculate_variance_report(uuid, uuid, uuid, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recalculate_variance_report(uuid, uuid, uuid, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recalculate_variance_report(uuid, uuid, uuid, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_variance_report(uuid, uuid, uuid, jsonb, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.lock_variance_report(uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lock_variance_report(uuid, uuid, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.lock_variance_report(uuid, uuid, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lock_variance_report(uuid, uuid, uuid, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.void_variance_report(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.void_variance_report(uuid, uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.void_variance_report(uuid, uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.void_variance_report(uuid, uuid, uuid, text) TO service_role;

-- Internal helpers: callable only from within SECURITY DEFINER RPCs.

REVOKE EXECUTE ON FUNCTION public.user_has_any_org_role(uuid, uuid, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_has_any_org_role(uuid, uuid, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_has_any_org_role(uuid, uuid, text[]) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.assert_actuals_lines_valid(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_actuals_lines_valid(uuid, uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.assert_actuals_lines_valid(uuid, uuid, jsonb) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.assert_forecast_driver_lines_reconcile(numeric, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_forecast_driver_lines_reconcile(numeric, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.assert_forecast_driver_lines_reconcile(numeric, jsonb) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.assert_reforecast_lines_consistent(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_reforecast_lines_consistent(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.assert_reforecast_lines_consistent(jsonb) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.insert_actuals_lines(uuid, record, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_actuals_lines(uuid, record, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_actuals_lines(uuid, record, jsonb) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.insert_forecast_driver_lines(uuid, record, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_forecast_driver_lines(uuid, record, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_forecast_driver_lines(uuid, record, jsonb) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.insert_reforecast_driver_impacts(uuid, record, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_reforecast_driver_impacts(uuid, record, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_reforecast_driver_impacts(uuid, record, jsonb) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.insert_reforecast_lines(uuid, record, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_reforecast_lines(uuid, record, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_reforecast_lines(uuid, record, jsonb) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.derive_planning_period(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.derive_planning_period(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.derive_planning_period(uuid, uuid, uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.assert_variance_lines_consistent(uuid, uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_variance_lines_consistent(uuid, uuid, uuid, uuid, uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.assert_variance_lines_consistent(uuid, uuid, uuid, uuid, uuid, jsonb) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.insert_variance_lines(uuid, record, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_variance_lines(uuid, record, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_variance_lines(uuid, record, jsonb) FROM authenticated;

-- Intentionally user-callable layer1 RPCs keep their authenticated grant but
-- lose the implicit PUBLIC grant.

REVOKE EXECUTE ON FUNCTION public.transition_layer1_handoff_status(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_layer1_handoff_status(uuid, uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.transition_layer1_version_lock_status(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_layer1_version_lock_status(uuid, uuid, text, text) TO authenticated;

