-- Workforce Planning and Labour Budget Governance Platform
-- Phase 7.1 (final) — Checksum Authority + Voided-Input Lifecycle Hardening
-- Scope: database-derived/verified checksums for actuals and variance locks,
-- baseline checksum read from budget_baselines (never from the caller),
-- database-side numeric payload validation, explicit voided-pinned-input
-- lifecycle enforcement. No product scope change; no waterfall; no AI.

-- pgcrypto provides sha256 digests so the database itself can derive and
-- verify governance checksums instead of trusting server-supplied values.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Helper: canonical two-decimal formatting identical to TypeScript toFixed(2)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.format_checksum_amount(value numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(to_char(COALESCE(value, 0), 'FM999999999999990.00'));
$$;

-- ---------------------------------------------------------------------------
-- Helper: DB-derived actuals checksum.
-- Canonical form mirrors the server engine exactly:
--   planning_period_id|period_number|cost|fte|hours  (rows joined by \n,
--   ordered by period_number, amounts formatted to two decimals)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.compute_actuals_checksum(
  target_organisation_id uuid,
  target_batch_id uuid
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  canonical text;
BEGIN
  SELECT string_agg(
    planning_period_id::text || '|' || period_number::text || '|' ||
    public.format_checksum_amount(actual_cost) || '|' ||
    public.format_checksum_amount(actual_fte) || '|' ||
    public.format_checksum_amount(actual_workload_hours),
    E'\n' ORDER BY period_number
  ) INTO canonical
  FROM public.actuals_lines
  WHERE organisation_id = target_organisation_id AND actuals_batch_id = target_batch_id;

  IF canonical IS NULL THEN
    RAISE EXCEPTION 'Cannot derive an actuals checksum: the batch has no rows';
  END IF;

  RETURN encode(extensions.digest(convert_to(canonical, 'UTF8'), 'sha256'), 'hex');
END;
$$;

-- ---------------------------------------------------------------------------
-- Helper: verify a submitted actuals checksum against the DB-derived value.
-- The stored checksum is always the database-derived one.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verify_and_store_actuals_checksum(
  target_organisation_id uuid,
  target_batch_id uuid,
  submitted_checksum text
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  derived_checksum text;
BEGIN
  derived_checksum := public.compute_actuals_checksum(target_organisation_id, target_batch_id);

  IF submitted_checksum IS NULL OR submitted_checksum <> derived_checksum THEN
    RAISE EXCEPTION 'Actuals checksum mismatch: submitted % does not match the database-derived checksum %', COALESCE(submitted_checksum, '(null)'), derived_checksum;
  END IF;

  UPDATE public.actuals_batches
  SET checksum = derived_checksum
  WHERE organisation_id = target_organisation_id AND id = target_batch_id;

  RETURN derived_checksum;
END;
$$;

-- ---------------------------------------------------------------------------
-- Helper: DB-derived variance lock checksum.
-- Canonical form mirrors the server engine exactly:
--   pins line: comparator_lock_version_id|comparator_checksum|baseline_checksum
--              |actuals_checksum|actuals_version_number
--   then per variance line ordered by period_number:
--   period_id|period_number|actual|forecast|baseline|costVarF|costVarB|
--   fteVarF|fteVarB|wlVarF|wlVarB  (two-decimal amounts)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.compute_variance_lock_checksum(
  target_organisation_id uuid,
  target_report_id uuid
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  report_row public.variance_reports%ROWTYPE;
  canonical_lines text;
  canonical text;
BEGIN
  SELECT * INTO report_row
  FROM public.variance_reports
  WHERE organisation_id = target_organisation_id AND id = target_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variance report not found for checksum derivation';
  END IF;

  SELECT string_agg(
    planning_period_id::text || '|' || period_number::text || '|' ||
    public.format_checksum_amount(actual_cost) || '|' ||
    public.format_checksum_amount(forecast_cost) || '|' ||
    public.format_checksum_amount(baseline_cost) || '|' ||
    public.format_checksum_amount(cost_variance_to_forecast) || '|' ||
    public.format_checksum_amount(cost_variance_to_baseline) || '|' ||
    public.format_checksum_amount(fte_variance_to_forecast) || '|' ||
    public.format_checksum_amount(fte_variance_to_baseline) || '|' ||
    public.format_checksum_amount(workload_variance_to_forecast) || '|' ||
    public.format_checksum_amount(workload_variance_to_baseline),
    E'\n' ORDER BY period_number
  ) INTO canonical_lines
  FROM public.variance_lines
  WHERE organisation_id = target_organisation_id AND variance_report_id = target_report_id;

  IF canonical_lines IS NULL THEN
    RAISE EXCEPTION 'Cannot derive a variance checksum: the report has no lines';
  END IF;

  canonical := report_row.comparator_lock_version_id || '|' || report_row.comparator_checksum || '|' ||
    COALESCE(report_row.baseline_checksum, '') || '|' || report_row.actuals_checksum || '|' ||
    report_row.actuals_version_number::text || E'\n' || canonical_lines;

  RETURN encode(extensions.digest(convert_to(canonical, 'UTF8'), 'sha256'), 'hex');
END;
$$;


-- ---------------------------------------------------------------------------
-- Re-emitted RPCs with database checksum authority, numeric payload
-- validation and voided-pinned-input lifecycle enforcement
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_actuals_lines_valid(
  target_organisation_id uuid,
  target_fiscal_year_id uuid,
  line_payloads jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  line_item jsonb;
  target_period_id uuid;
  period_count integer;
  seen_period_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF line_payloads IS NULL OR jsonb_typeof(line_payloads) <> 'array' OR jsonb_array_length(line_payloads) = 0 THEN
    RAISE EXCEPTION 'Actuals rows are required';
  END IF;

  FOR line_item IN SELECT * FROM jsonb_array_elements(line_payloads)
  LOOP
    target_period_id := (line_item->>'planning_period_id')::uuid;

    -- Every row must map to an existing planning period owned by the
    -- organisation inside the selected baseline horizon. No silent mappings.
    SELECT COUNT(*) INTO period_count
    FROM public.planning_periods
    WHERE organisation_id = target_organisation_id
      AND id = target_period_id
      AND fiscal_year_id = target_fiscal_year_id;

    IF period_count = 0 THEN
      RAISE EXCEPTION 'Actuals row rejected: period does not exist for this organisation within the baseline horizon';
    END IF;

    IF target_period_id = ANY(seen_period_ids) THEN
      RAISE EXCEPTION 'Actuals row rejected: duplicate planning period in batch';
    END IF;
    seen_period_ids := array_append(seen_period_ids, target_period_id);

    -- UAT hardening: numeric sanity is enforced in the database, not only in
    -- the server engine. Values must be present, must be JSON numbers (JSON
    -- cannot encode NaN/Infinity, and strings are rejected), and must sit
    -- inside the column precision bounds of the product model.
    IF line_item->'actual_cost' IS NULL OR jsonb_typeof(line_item->'actual_cost') <> 'number'
      OR line_item->'actual_fte' IS NULL OR jsonb_typeof(line_item->'actual_fte') <> 'number'
      OR line_item->'actual_workload_hours' IS NULL OR jsonb_typeof(line_item->'actual_workload_hours') <> 'number' THEN
      RAISE EXCEPTION 'Actuals row rejected: actual_cost, actual_fte and actual_workload_hours must be present JSON numbers';
    END IF;
    IF abs((line_item->>'actual_cost')::numeric) >= 100000000000000::numeric
      OR abs((line_item->>'actual_fte')::numeric) >= 100000000::numeric
      OR abs((line_item->>'actual_workload_hours')::numeric) >= 10000000000::numeric THEN
      RAISE EXCEPTION 'Actuals row rejected: value outside the numeric bounds of the product model';
    END IF;
  END LOOP;
END;
$$;

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

  -- UAT hardening: the actuals checksum is database-derived from the inserted
  -- rows; the submitted server checksum must match or the batch is rejected.
  new_batch.checksum := public.verify_and_store_actuals_checksum(target_organisation_id, new_batch.id, batch_payload->>'checksum');

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
  SET batch_name = COALESCE(batch_payload->>'batch_name', batch_name)
  WHERE organisation_id = target_organisation_id AND id = target_batch_id
  RETURNING * INTO updated_batch;

  -- UAT hardening: checksum is database-derived and verified, never stored
  -- from the caller payload.
  updated_batch.checksum := public.verify_and_store_actuals_checksum(target_organisation_id, target_batch_id, batch_payload->>'checksum');

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

  -- UAT hardening: the correction checksum is database-derived and verified
  -- BEFORE the rows are frozen.
  replacement_batch.checksum := public.verify_and_store_actuals_checksum(target_organisation_id, replacement_batch.id, replacement_payload->>'checksum');

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
  target_baseline public.budget_baselines%ROWTYPE;
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

  IF target_batch.status = 'voided' THEN
    RAISE EXCEPTION 'Variance cannot be created from a voided actuals batch';
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

  IF target_reforecast.status = 'voided' THEN
    RAISE EXCEPTION 'Variance cannot be created from a voided forecast';
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

  -- UAT hardening: the baseline checksum is read from the stored locked
  -- baseline, never trusted from the caller payload.
  SELECT * INTO target_baseline
  FROM public.budget_baselines
  WHERE organisation_id = target_organisation_id AND id = target_batch.baseline_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget baseline not found for organisation';
  END IF;
  IF target_baseline.checksum IS NULL THEN
    RAISE EXCEPTION 'Locked baseline is missing its checksum; variance cannot pin the baseline artifact';
  END IF;

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
    target_baseline.checksum,
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
  pinned_batch_status text;
  pinned_forecast_status text;
  derived_lock_checksum text;
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

  -- UAT hardening: lock re-checks that the pinned inputs are still valid.
  -- Draft variance reports pinned to inputs that were later voided cannot be
  -- locked; already-locked reports remain readable history regardless.
  SELECT status INTO pinned_batch_status
  FROM public.actuals_batches
  WHERE organisation_id = target_organisation_id AND id = current_report.actuals_batch_id;
  IF pinned_batch_status = 'voided' THEN
    RAISE EXCEPTION 'Cannot lock: the pinned actuals batch has been voided since this variance report was created';
  END IF;

  SELECT status INTO pinned_forecast_status
  FROM public.reforecasts
  WHERE organisation_id = target_organisation_id AND id = current_report.reforecast_id;
  IF pinned_forecast_status = 'voided' THEN
    RAISE EXCEPTION 'Cannot lock: the pinned forecast has been voided since this variance report was created';
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

  -- UAT hardening: the lock checksum is recomputed by the database from the
  -- stored variance lines and pinned inputs (comparator lock version and
  -- checksum, baseline checksum, actuals checksum and version, period ids and
  -- line values). The submitted checksum must match; the stored value is the
  -- database-derived one.
  derived_lock_checksum := public.compute_variance_lock_checksum(target_organisation_id, target_report_id);
  IF lock_checksum <> derived_lock_checksum THEN
    RAISE EXCEPTION 'Variance lock checksum mismatch: submitted % does not match the database-derived checksum %', lock_checksum, derived_lock_checksum;
  END IF;

  new_lock_version_id := 'VARL-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || left(target_report_id::text, 8);

  UPDATE public.variance_reports
  SET status = 'locked',
      is_current_locked = true,
      is_immutable = true,
      locked_by = target_actor_user_id,
      locked_at = now(),
      lock_version_id = new_lock_version_id,
      checksum = derived_lock_checksum
  WHERE organisation_id = target_organisation_id AND id = target_report_id
  RETURNING * INTO locked_report;

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id, target_actor_user_id, 'variance.report_locked', 'variance_report', locked_report.id,
    locked_report.plan_id, locked_report.fiscal_year_id,
    jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'locked', 'is_current_locked', true, 'lock_version_id', new_lock_version_id, 'checksum', derived_lock_checksum),
    COALESCE(lock_reason, 'Variance report locked')
  );

  RETURN to_jsonb(locked_report);
END;
$$;

-- ---------------------------------------------------------------------------
-- Privilege hardening for the new helpers: internal only, no client grants.
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.format_checksum_amount(numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.format_checksum_amount(numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.format_checksum_amount(numeric) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_actuals_checksum(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_actuals_checksum(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.compute_actuals_checksum(uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_and_store_actuals_checksum(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_and_store_actuals_checksum(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.verify_and_store_actuals_checksum(uuid, uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_variance_lock_checksum(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_variance_lock_checksum(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.compute_variance_lock_checksum(uuid, uuid) FROM authenticated;
