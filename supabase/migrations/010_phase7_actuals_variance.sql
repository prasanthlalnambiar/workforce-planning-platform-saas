-- Workforce Planning and Labour Budget Governance Platform
-- Phase 7 Actuals Ingestion + Variance Module
-- Scope: versioned actuals mapped strictly to planning periods, immutable posted
-- actuals with supersession-based corrections, deterministic variance pinned to a
-- specific locked reforecast version/checksum and locked baseline checksum.
-- No waterfall bridge, executive bridge reporting or AI advisory.

CREATE TABLE public.actuals_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  baseline_id uuid NOT NULL,
  reforecast_id uuid,
  batch_code text NOT NULL,
  batch_name text NOT NULL,
  version_number integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'posted', 'superseded', 'voided')),
  source_type text NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'csv')),
  uploaded_by uuid REFERENCES public.profiles(id),
  validated_by uuid REFERENCES public.profiles(id),
  validated_at timestamptz,
  posted_by uuid REFERENCES public.profiles(id),
  posted_at timestamptz,
  supersedes_batch_id uuid,
  superseded_by_batch_id uuid,
  voided_by uuid REFERENCES public.profiles(id),
  voided_at timestamptz,
  checksum text,
  is_immutable boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, plan_id, fiscal_year_id, batch_code),
  CONSTRAINT actuals_batches_plan_same_org_fk FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT actuals_batches_fiscal_year_same_org_fk FOREIGN KEY (organisation_id, fiscal_year_id) REFERENCES public.fiscal_years(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT actuals_batches_baseline_same_org_fk FOREIGN KEY (organisation_id, baseline_id) REFERENCES public.budget_baselines(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT actuals_batches_reforecast_same_org_fk FOREIGN KEY (organisation_id, reforecast_id) REFERENCES public.reforecasts(organisation_id, id),
  CONSTRAINT actuals_batches_supersedes_same_org_fk FOREIGN KEY (organisation_id, supersedes_batch_id) REFERENCES public.actuals_batches(organisation_id, id),
  CONSTRAINT actuals_batches_superseded_by_same_org_fk FOREIGN KEY (organisation_id, superseded_by_batch_id) REFERENCES public.actuals_batches(organisation_id, id)
);

CREATE TABLE public.actuals_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  actuals_batch_id uuid NOT NULL,
  planning_period_id uuid NOT NULL,
  period_number integer NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  actual_cost numeric(18,2) NOT NULL DEFAULT 0,
  actual_fte numeric(12,2) NOT NULL DEFAULT 0,
  actual_workload_hours numeric(14,2) NOT NULL DEFAULT 0,
  source_row_reference text,
  is_immutable boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  -- A planning period can appear at most once per batch: duplicate period rows
  -- are rejected rather than silently merged.
  UNIQUE (organisation_id, actuals_batch_id, planning_period_id),
  CONSTRAINT actuals_lines_batch_same_org_fk FOREIGN KEY (organisation_id, actuals_batch_id) REFERENCES public.actuals_batches(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT actuals_lines_period_same_org_fk FOREIGN KEY (organisation_id, planning_period_id) REFERENCES public.planning_periods(organisation_id, id) ON DELETE CASCADE
);

CREATE TABLE public.variance_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  baseline_id uuid NOT NULL,
  reforecast_id uuid NOT NULL,
  actuals_batch_id uuid NOT NULL,
  report_code text NOT NULL,
  report_name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'locked', 'superseded', 'voided')),
  is_current_locked boolean NOT NULL DEFAULT false,
  -- Pinned comparators: variance never re-resolves "current forecast" later.
  comparator_lock_version_id text NOT NULL,
  comparator_checksum text NOT NULL,
  baseline_checksum text,
  actuals_checksum text NOT NULL,
  actuals_version_number integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.profiles(id),
  locked_by uuid REFERENCES public.profiles(id),
  locked_at timestamptz,
  lock_version_id text,
  superseded_by_variance_id uuid,
  voided_by uuid REFERENCES public.profiles(id),
  voided_at timestamptz,
  checksum text,
  is_immutable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, plan_id, fiscal_year_id, report_code),
  CONSTRAINT variance_reports_plan_same_org_fk FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT variance_reports_fiscal_year_same_org_fk FOREIGN KEY (organisation_id, fiscal_year_id) REFERENCES public.fiscal_years(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT variance_reports_baseline_same_org_fk FOREIGN KEY (organisation_id, baseline_id) REFERENCES public.budget_baselines(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT variance_reports_reforecast_same_org_fk FOREIGN KEY (organisation_id, reforecast_id) REFERENCES public.reforecasts(organisation_id, id),
  CONSTRAINT variance_reports_actuals_same_org_fk FOREIGN KEY (organisation_id, actuals_batch_id) REFERENCES public.actuals_batches(organisation_id, id),
  CONSTRAINT variance_reports_superseded_by_same_org_fk FOREIGN KEY (organisation_id, superseded_by_variance_id) REFERENCES public.variance_reports(organisation_id, id)
);

-- The latest locked variance report is the current one per forecast context.
CREATE UNIQUE INDEX variance_reports_one_current_locked_per_context
  ON public.variance_reports (organisation_id, baseline_id, reforecast_id)
  WHERE is_current_locked = true;

CREATE TABLE public.variance_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  variance_report_id uuid NOT NULL,
  planning_period_id uuid NOT NULL,
  period_number integer NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  actual_cost numeric(18,2) NOT NULL DEFAULT 0,
  forecast_cost numeric(18,2) NOT NULL DEFAULT 0,
  baseline_cost numeric(18,2) NOT NULL DEFAULT 0,
  cost_variance_to_forecast numeric(18,2) NOT NULL DEFAULT 0,
  cost_variance_to_forecast_pct numeric(9,2),
  cost_variance_to_baseline numeric(18,2) NOT NULL DEFAULT 0,
  cost_variance_to_baseline_pct numeric(9,2),
  actual_fte numeric(12,2) NOT NULL DEFAULT 0,
  forecast_fte numeric(12,2) NOT NULL DEFAULT 0,
  baseline_fte numeric(12,2) NOT NULL DEFAULT 0,
  fte_variance_to_forecast numeric(12,2) NOT NULL DEFAULT 0,
  fte_variance_to_baseline numeric(12,2) NOT NULL DEFAULT 0,
  actual_workload_hours numeric(14,2) NOT NULL DEFAULT 0,
  forecast_workload_hours numeric(14,2) NOT NULL DEFAULT 0,
  baseline_workload_hours numeric(14,2) NOT NULL DEFAULT 0,
  workload_variance_to_forecast numeric(14,2) NOT NULL DEFAULT 0,
  workload_variance_to_baseline numeric(14,2) NOT NULL DEFAULT 0,
  is_immutable boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, variance_report_id, planning_period_id),
  CONSTRAINT variance_lines_report_same_org_fk FOREIGN KEY (organisation_id, variance_report_id) REFERENCES public.variance_reports(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT variance_lines_period_same_org_fk FOREIGN KEY (organisation_id, planning_period_id) REFERENCES public.planning_periods(organisation_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_actuals_batches_org_context ON public.actuals_batches(organisation_id, baseline_id, version_number DESC);
CREATE INDEX idx_actuals_lines_batch ON public.actuals_lines(organisation_id, actuals_batch_id, period_number);
CREATE INDEX idx_variance_reports_org_context ON public.variance_reports(organisation_id, baseline_id, reforecast_id, created_at DESC);
CREATE INDEX idx_variance_lines_report ON public.variance_lines(organisation_id, variance_report_id, period_number);

CREATE TRIGGER actuals_batches_set_updated_at BEFORE UPDATE ON public.actuals_batches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER actuals_lines_set_updated_at BEFORE UPDATE ON public.actuals_lines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER variance_reports_set_updated_at BEFORE UPDATE ON public.variance_reports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER variance_lines_set_updated_at BEFORE UPDATE ON public.variance_lines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.actuals_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actuals_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.variance_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.variance_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY actuals_batches_select_member ON public.actuals_batches
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY actuals_lines_select_member ON public.actuals_lines
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY variance_reports_select_member ON public.variance_reports
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY variance_lines_select_member ON public.variance_lines
  FOR SELECT USING (public.is_org_member(organisation_id));

-- All material writes flow through controlled SECURITY DEFINER RPCs executed by
-- the server-side service role only.
REVOKE INSERT, UPDATE, DELETE ON public.actuals_batches FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.actuals_lines FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.variance_reports FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.variance_lines FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Immutability protection
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_actuals_batch_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' OR OLD.is_immutable = true THEN
      RAISE EXCEPTION 'Only draft actuals batches can be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IN ('superseded', 'voided') THEN
    RAISE EXCEPTION 'Actuals batch is in a terminal state and remains readable for history only';
  END IF;

  IF OLD.status = 'posted' OR OLD.is_immutable = true THEN
    -- Posted actuals are immutable. The only permitted changes are the
    -- controlled supersession by a correction batch and admin-controlled
    -- voiding. Actual values can never change.
    IF NEW.batch_name IS NOT DISTINCT FROM OLD.batch_name
      AND NEW.baseline_id IS NOT DISTINCT FROM OLD.baseline_id
      AND NEW.reforecast_id IS NOT DISTINCT FROM OLD.reforecast_id
      AND NEW.version_number IS NOT DISTINCT FROM OLD.version_number
      AND NEW.checksum IS NOT DISTINCT FROM OLD.checksum
      AND NEW.posted_by IS NOT DISTINCT FROM OLD.posted_by
      AND NEW.posted_at IS NOT DISTINCT FROM OLD.posted_at
    THEN
      IF NEW.status = 'superseded' AND NEW.superseded_by_batch_id IS NOT NULL THEN
        RETURN NEW;
      END IF;
      IF NEW.status = 'voided' AND NEW.voided_by IS NOT NULL THEN
        RETURN NEW;
      END IF;
    END IF;
    RAISE EXCEPTION 'Posted actuals are immutable. Corrections must create a new superseding batch version.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_actuals_line_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status
  FROM public.actuals_batches
  WHERE organisation_id = OLD.organisation_id AND id = OLD.actuals_batch_id;

  IF TG_OP = 'DELETE' THEN
    IF OLD.is_immutable = true OR COALESCE(parent_status, 'draft') NOT IN ('draft', 'validated') THEN
      RAISE EXCEPTION 'Actuals rows of posted batches cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_immutable = true THEN
    RAISE EXCEPTION 'Actuals rows are immutable once the batch is posted';
  END IF;

  IF COALESCE(parent_status, 'draft') NOT IN ('draft', 'validated') THEN
    IF NEW.is_immutable = true THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Actuals rows cannot change after governance transitions';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_variance_report_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' OR OLD.is_immutable = true THEN
      RAISE EXCEPTION 'Only draft variance reports can be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IN ('superseded', 'voided') THEN
    RAISE EXCEPTION 'Variance report is in a terminal state and remains readable for history only';
  END IF;

  IF OLD.status = 'locked' OR OLD.is_immutable = true THEN
    IF NEW.report_name IS NOT DISTINCT FROM OLD.report_name
      AND NEW.comparator_lock_version_id IS NOT DISTINCT FROM OLD.comparator_lock_version_id
      AND NEW.comparator_checksum IS NOT DISTINCT FROM OLD.comparator_checksum
      AND NEW.actuals_checksum IS NOT DISTINCT FROM OLD.actuals_checksum
      AND NEW.actuals_batch_id IS NOT DISTINCT FROM OLD.actuals_batch_id
      AND NEW.checksum IS NOT DISTINCT FROM OLD.checksum
      AND NEW.lock_version_id IS NOT DISTINCT FROM OLD.lock_version_id
    THEN
      IF NEW.status = 'superseded' AND NEW.superseded_by_variance_id IS NOT NULL AND NEW.is_current_locked = false THEN
        RETURN NEW;
      END IF;
      IF NEW.status = 'voided' AND NEW.voided_by IS NOT NULL AND NEW.is_current_locked = false THEN
        RETURN NEW;
      END IF;
    END IF;
    RAISE EXCEPTION 'Locked variance reports are immutable. Later forecast locks or corrections require a new variance report.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_variance_line_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status
  FROM public.variance_reports
  WHERE organisation_id = OLD.organisation_id AND id = OLD.variance_report_id;

  IF TG_OP = 'DELETE' THEN
    IF OLD.is_immutable = true OR COALESCE(parent_status, 'draft') <> 'draft' THEN
      RAISE EXCEPTION 'Variance rows of locked reports cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_immutable = true THEN
    RAISE EXCEPTION 'Variance rows are immutable once the report is locked';
  END IF;

  IF COALESCE(parent_status, 'draft') <> 'draft' THEN
    IF NEW.is_immutable = true THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Variance rows cannot change after governance transitions';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_actuals_batch_update
BEFORE UPDATE OR DELETE ON public.actuals_batches
FOR EACH ROW EXECUTE FUNCTION public.protect_actuals_batch_update();

CREATE TRIGGER protect_actuals_line_update
BEFORE UPDATE OR DELETE ON public.actuals_lines
FOR EACH ROW EXECUTE FUNCTION public.protect_actuals_line_update();

CREATE TRIGGER protect_variance_report_update
BEFORE UPDATE OR DELETE ON public.variance_reports
FOR EACH ROW EXECUTE FUNCTION public.protect_variance_report_update();

CREATE TRIGGER protect_variance_line_update
BEFORE UPDATE OR DELETE ON public.variance_lines
FOR EACH ROW EXECUTE FUNCTION public.protect_variance_line_update();

-- ---------------------------------------------------------------------------
-- Shared helpers
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
  END LOOP;
END;
$$;

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
BEGIN
  FOR line_item IN SELECT * FROM jsonb_array_elements(line_payloads)
  LOOP
    INSERT INTO public.actuals_lines (
      organisation_id, actuals_batch_id, planning_period_id,
      period_number, period_start, period_end,
      actual_cost, actual_fte, actual_workload_hours,
      source_row_reference, created_by
    ) VALUES (
      target_organisation_id,
      target_batch.id,
      (line_item->>'planning_period_id')::uuid,
      COALESCE((line_item->>'period_number')::integer, 0),
      (line_item->>'period_start')::date,
      (line_item->>'period_end')::date,
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
-- RPC: create a draft actuals batch
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
BEGIN
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

-- ---------------------------------------------------------------------------
-- RPC: update a draft actuals batch (draft actuals are editable)
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- RPC: actuals lifecycle transitions (validate, revert, post, void)
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- RPC: supersede a posted batch with a correction version (atomic)
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- RPC: create a draft variance report with pinned comparators
-- ---------------------------------------------------------------------------

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
  line_item jsonb;
  next_code_number integer;
BEGIN
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

  IF jsonb_typeof(line_payloads) <> 'array' OR jsonb_array_length(line_payloads) = 0 THEN
    RAISE EXCEPTION 'Variance lines are required';
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
    report_payload->>'baseline_checksum',
    COALESCE(target_batch.checksum, ''),
    target_batch.version_number,
    target_actor_user_id
  )
  RETURNING * INTO new_report;

  FOR line_item IN SELECT * FROM jsonb_array_elements(line_payloads)
  LOOP
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
      new_report.id,
      (line_item->>'planning_period_id')::uuid,
      COALESCE((line_item->>'period_number')::integer, 0),
      (line_item->>'period_start')::date,
      (line_item->>'period_end')::date,
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
      target_actor_user_id
    );
  END LOOP;

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

-- ---------------------------------------------------------------------------
-- RPC: recalculate a draft variance report (same pinned comparators)
-- ---------------------------------------------------------------------------

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
  line_item jsonb;
BEGIN
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

  DELETE FROM public.variance_lines
  WHERE organisation_id = target_organisation_id AND variance_report_id = target_report_id;

  FOR line_item IN SELECT * FROM jsonb_array_elements(line_payloads)
  LOOP
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
      current_report.id,
      (line_item->>'planning_period_id')::uuid,
      COALESCE((line_item->>'period_number')::integer, 0),
      (line_item->>'period_start')::date,
      (line_item->>'period_end')::date,
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
      target_actor_user_id
    );
  END LOOP;

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
-- RPC: lock a variance report (immutable, supersedes previous current)
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- RPC: void a variance report (admin-controlled)
-- ---------------------------------------------------------------------------

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
-- Lock down the governance surface to the server-side service role only
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.create_actuals_batch(uuid, uuid, jsonb, jsonb, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.update_actuals_batch_draft(uuid, uuid, uuid, jsonb, jsonb, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_actuals_batch_status(uuid, uuid, uuid, text, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.supersede_actuals_batch(uuid, uuid, uuid, jsonb, jsonb, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.create_variance_report(uuid, uuid, jsonb, jsonb, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_variance_report(uuid, uuid, uuid, jsonb, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.lock_variance_report(uuid, uuid, uuid, text, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.void_variance_report(uuid, uuid, uuid, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_actuals_lines_valid(uuid, uuid, jsonb) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.insert_actuals_lines(uuid, record, jsonb) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_actuals_batch(uuid, uuid, jsonb, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_actuals_batch_draft(uuid, uuid, uuid, jsonb, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_actuals_batch_status(uuid, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.supersede_actuals_batch(uuid, uuid, uuid, jsonb, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_variance_report(uuid, uuid, jsonb, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_variance_report(uuid, uuid, uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_variance_report(uuid, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.void_variance_report(uuid, uuid, uuid, text) TO service_role;
