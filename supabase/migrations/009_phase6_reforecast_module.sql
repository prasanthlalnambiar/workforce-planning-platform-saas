-- Workforce Planning and Labour Budget Governance Platform
-- Phase 6 Reforecast Module
-- Scope: working forecast = locked budget baseline + approved drivers, controlled
-- review, immutable forecast lock with snapshot and checksum, supersession so the
-- latest locked forecast is the single current valid forecast, full audit.
-- No actuals ingestion, variance analysis, waterfall reporting or AI.

CREATE TABLE public.reforecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  budget_baseline_id uuid NOT NULL,
  reforecast_code text NOT NULL,
  reforecast_name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'locked', 'superseded', 'voided')),
  is_current_locked boolean NOT NULL DEFAULT false,
  calculated_at timestamptz,
  calculation_checksum text,
  approved_driver_count integer NOT NULL DEFAULT 0,
  submitted_by uuid REFERENCES public.profiles(id),
  submitted_at timestamptz,
  locked_by uuid REFERENCES public.profiles(id),
  locked_at timestamptz,
  lock_version_id text,
  checksum text,
  is_immutable boolean NOT NULL DEFAULT false,
  supersedes_reforecast_id uuid,
  superseded_by_reforecast_id uuid,
  voided_by uuid REFERENCES public.profiles(id),
  voided_at timestamptz,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, plan_id, fiscal_year_id, reforecast_code),
  CONSTRAINT reforecasts_plan_same_org_fk FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT reforecasts_fiscal_year_same_org_fk FOREIGN KEY (organisation_id, fiscal_year_id) REFERENCES public.fiscal_years(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT reforecasts_baseline_same_org_fk FOREIGN KEY (organisation_id, budget_baseline_id) REFERENCES public.budget_baselines(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT reforecasts_supersedes_same_org_fk FOREIGN KEY (organisation_id, supersedes_reforecast_id) REFERENCES public.reforecasts(organisation_id, id),
  CONSTRAINT reforecasts_superseded_by_same_org_fk FOREIGN KEY (organisation_id, superseded_by_reforecast_id) REFERENCES public.reforecasts(organisation_id, id)
);

-- The latest locked forecast is the single current valid forecast per baseline context.
CREATE UNIQUE INDEX reforecasts_one_current_locked_per_context
  ON public.reforecasts (organisation_id, budget_baseline_id)
  WHERE is_current_locked = true;

CREATE TABLE public.reforecast_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  reforecast_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  period_id uuid NOT NULL,
  period_number integer NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  baseline_budget_amount numeric(18,2) NOT NULL DEFAULT 0,
  baseline_labour_cost numeric(18,2) NOT NULL DEFAULT 0,
  baseline_required_fte numeric(12,2) NOT NULL DEFAULT 0,
  baseline_workload_hours numeric(14,2) NOT NULL DEFAULT 0,
  growth_cost_impact numeric(18,2) NOT NULL DEFAULT 0,
  efficiency_cost_impact numeric(18,2) NOT NULL DEFAULT 0,
  cost_change_cost_impact numeric(18,2) NOT NULL DEFAULT 0,
  supply_change_cost_impact numeric(18,2) NOT NULL DEFAULT 0,
  management_adjustment_cost_impact numeric(18,2) NOT NULL DEFAULT 0,
  total_cost_impact numeric(18,2) NOT NULL DEFAULT 0,
  total_fte_impact numeric(12,2) NOT NULL DEFAULT 0,
  total_workload_hours_impact numeric(14,2) NOT NULL DEFAULT 0,
  forecast_budget_amount numeric(18,2) NOT NULL DEFAULT 0,
  forecast_labour_cost numeric(18,2) NOT NULL DEFAULT 0,
  forecast_required_fte numeric(12,2) NOT NULL DEFAULT 0,
  forecast_workload_hours numeric(14,2) NOT NULL DEFAULT 0,
  is_immutable boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, reforecast_id, period_id),
  CONSTRAINT reforecast_lines_reforecast_same_org_fk FOREIGN KEY (organisation_id, reforecast_id) REFERENCES public.reforecasts(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT reforecast_lines_plan_same_org_fk FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT reforecast_lines_fiscal_year_same_org_fk FOREIGN KEY (organisation_id, fiscal_year_id) REFERENCES public.fiscal_years(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT reforecast_lines_period_same_org_fk FOREIGN KEY (organisation_id, period_id) REFERENCES public.planning_periods(organisation_id, id) ON DELETE CASCADE
);

-- Inclusion snapshot: exactly which approved drivers fed the working forecast.
CREATE TABLE public.reforecast_driver_impacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  reforecast_id uuid NOT NULL,
  forecast_driver_id uuid NOT NULL,
  driver_code text NOT NULL,
  driver_name text NOT NULL,
  category text NOT NULL,
  impact_type text NOT NULL,
  annual_impact_amount numeric(18,2) NOT NULL,
  driver_status_at_calculation text NOT NULL DEFAULT 'approved',
  is_immutable boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, reforecast_id, forecast_driver_id),
  CONSTRAINT reforecast_driver_impacts_reforecast_same_org_fk FOREIGN KEY (organisation_id, reforecast_id) REFERENCES public.reforecasts(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT reforecast_driver_impacts_driver_same_org_fk FOREIGN KEY (organisation_id, forecast_driver_id) REFERENCES public.forecast_drivers(organisation_id, id)
);

-- Immutable lock snapshots: full forecast state captured at lock time.
CREATE TABLE public.reforecast_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  reforecast_id uuid NOT NULL,
  snapshot_type text NOT NULL DEFAULT 'lock' CHECK (snapshot_type IN ('lock')),
  snapshot_json jsonb NOT NULL,
  checksum text NOT NULL,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  CONSTRAINT reforecast_snapshots_reforecast_same_org_fk FOREIGN KEY (organisation_id, reforecast_id) REFERENCES public.reforecasts(organisation_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_reforecasts_org_context ON public.reforecasts(organisation_id, plan_id, fiscal_year_id, created_at DESC);
CREATE INDEX idx_reforecast_lines_reforecast ON public.reforecast_lines(organisation_id, reforecast_id, period_number);
CREATE INDEX idx_reforecast_driver_impacts_reforecast ON public.reforecast_driver_impacts(organisation_id, reforecast_id);
CREATE INDEX idx_reforecast_snapshots_reforecast ON public.reforecast_snapshots(organisation_id, reforecast_id, created_at DESC);

CREATE TRIGGER reforecasts_set_updated_at BEFORE UPDATE ON public.reforecasts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER reforecast_lines_set_updated_at BEFORE UPDATE ON public.reforecast_lines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER reforecast_driver_impacts_set_updated_at BEFORE UPDATE ON public.reforecast_driver_impacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.reforecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reforecast_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reforecast_driver_impacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reforecast_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY reforecasts_select_member ON public.reforecasts
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY reforecast_lines_select_member ON public.reforecast_lines
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY reforecast_driver_impacts_select_member ON public.reforecast_driver_impacts
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY reforecast_snapshots_select_member ON public.reforecast_snapshots
  FOR SELECT USING (public.is_org_member(organisation_id));

-- All forecast writes are routed through controlled SECURITY DEFINER RPCs executed
-- by the server-side service role only.
REVOKE INSERT, UPDATE, DELETE ON public.reforecasts FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.reforecast_lines FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.reforecast_driver_impacts FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.reforecast_snapshots FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Immutability protection
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_reforecast_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' OR OLD.is_immutable = true THEN
      RAISE EXCEPTION 'Only draft reforecasts can be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IN ('superseded', 'voided') THEN
    RAISE EXCEPTION 'Reforecast is in a terminal state and remains readable for history only';
  END IF;

  IF OLD.status = 'locked' OR OLD.is_immutable = true THEN
    -- The only permitted changes to a locked forecast are the controlled
    -- supersession (when a newer forecast is locked) and admin-controlled
    -- voiding. Business values can never change.
    IF NEW.reforecast_name IS NOT DISTINCT FROM OLD.reforecast_name
      AND NEW.budget_baseline_id IS NOT DISTINCT FROM OLD.budget_baseline_id
      AND NEW.calculation_checksum IS NOT DISTINCT FROM OLD.calculation_checksum
      AND NEW.checksum IS NOT DISTINCT FROM OLD.checksum
      AND NEW.lock_version_id IS NOT DISTINCT FROM OLD.lock_version_id
      AND NEW.locked_by IS NOT DISTINCT FROM OLD.locked_by
      AND NEW.locked_at IS NOT DISTINCT FROM OLD.locked_at
      AND NEW.approved_driver_count IS NOT DISTINCT FROM OLD.approved_driver_count
    THEN
      IF NEW.status = 'superseded' AND NEW.superseded_by_reforecast_id IS NOT NULL AND NEW.is_current_locked = false THEN
        RETURN NEW;
      END IF;
      IF NEW.status = 'voided' AND NEW.voided_by IS NOT NULL AND NEW.is_current_locked = false THEN
        RETURN NEW;
      END IF;
    END IF;
    RAISE EXCEPTION 'Locked reforecasts are immutable. Corrections require a new forecast version, supersession or admin-controlled voiding.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_reforecast_child_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
  parent_org uuid;
  parent_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    parent_org := OLD.organisation_id;
    parent_id := OLD.reforecast_id;
  ELSE
    parent_org := OLD.organisation_id;
    parent_id := OLD.reforecast_id;
  END IF;

  SELECT status INTO parent_status
  FROM public.reforecasts
  WHERE organisation_id = parent_org AND id = parent_id;

  IF TG_OP = 'DELETE' THEN
    IF OLD.is_immutable = true OR COALESCE(parent_status, 'draft') NOT IN ('draft', 'in_review') THEN
      RAISE EXCEPTION 'Reforecast detail rows of governed forecasts cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_immutable = true THEN
    RAISE EXCEPTION 'Reforecast detail rows are immutable once the forecast is locked';
  END IF;

  IF COALESCE(parent_status, 'draft') NOT IN ('draft', 'in_review') THEN
    IF NEW.is_immutable = true THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Reforecast detail rows cannot change after governance transitions';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_reforecast_snapshot_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Reforecast lock snapshots are append-only audit evidence';
END;
$$;

CREATE TRIGGER protect_reforecast_update
BEFORE UPDATE OR DELETE ON public.reforecasts
FOR EACH ROW EXECUTE FUNCTION public.protect_reforecast_update();

CREATE TRIGGER protect_reforecast_line_update
BEFORE UPDATE OR DELETE ON public.reforecast_lines
FOR EACH ROW EXECUTE FUNCTION public.protect_reforecast_child_update();

CREATE TRIGGER protect_reforecast_driver_impact_update
BEFORE UPDATE OR DELETE ON public.reforecast_driver_impacts
FOR EACH ROW EXECUTE FUNCTION public.protect_reforecast_child_update();

CREATE TRIGGER protect_reforecast_snapshot_update
BEFORE UPDATE OR DELETE ON public.reforecast_snapshots
FOR EACH ROW EXECUTE FUNCTION public.protect_reforecast_snapshot_update();

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_reforecast_lines_consistent(line_payloads jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  line_item jsonb;
  drift numeric;
BEGIN
  IF line_payloads IS NULL OR jsonb_typeof(line_payloads) <> 'array' OR jsonb_array_length(line_payloads) = 0 THEN
    RAISE EXCEPTION 'Reforecast lines are required';
  END IF;

  FOR line_item IN SELECT * FROM jsonb_array_elements(line_payloads)
  LOOP
    drift := abs(
      COALESCE((line_item->>'forecast_budget_amount')::numeric, 0)
      - COALESCE((line_item->>'baseline_budget_amount')::numeric, 0)
      - COALESCE((line_item->>'total_cost_impact')::numeric, 0)
    );
    IF drift > 0.01 THEN
      RAISE EXCEPTION 'Reforecast line does not reconcile: forecast must equal baseline plus approved driver impact (drift %)', drift;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_reforecast_lines(
  target_organisation_id uuid,
  target_reforecast record,
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
    INSERT INTO public.reforecast_lines (
      organisation_id, reforecast_id, plan_id, fiscal_year_id,
      period_id, period_number, period_start, period_end,
      baseline_budget_amount, baseline_labour_cost, baseline_required_fte, baseline_workload_hours,
      growth_cost_impact, efficiency_cost_impact, cost_change_cost_impact, supply_change_cost_impact, management_adjustment_cost_impact,
      total_cost_impact, total_fte_impact, total_workload_hours_impact,
      forecast_budget_amount, forecast_labour_cost, forecast_required_fte, forecast_workload_hours,
      created_by
    ) VALUES (
      target_organisation_id,
      target_reforecast.id,
      target_reforecast.plan_id,
      target_reforecast.fiscal_year_id,
      (line_item->>'period_id')::uuid,
      COALESCE((line_item->>'period_number')::integer, 0),
      (line_item->>'period_start')::date,
      (line_item->>'period_end')::date,
      COALESCE((line_item->>'baseline_budget_amount')::numeric, 0),
      COALESCE((line_item->>'baseline_labour_cost')::numeric, 0),
      COALESCE((line_item->>'baseline_required_fte')::numeric, 0),
      COALESCE((line_item->>'baseline_workload_hours')::numeric, 0),
      COALESCE((line_item->>'growth_cost_impact')::numeric, 0),
      COALESCE((line_item->>'efficiency_cost_impact')::numeric, 0),
      COALESCE((line_item->>'cost_change_cost_impact')::numeric, 0),
      COALESCE((line_item->>'supply_change_cost_impact')::numeric, 0),
      COALESCE((line_item->>'management_adjustment_cost_impact')::numeric, 0),
      COALESCE((line_item->>'total_cost_impact')::numeric, 0),
      COALESCE((line_item->>'total_fte_impact')::numeric, 0),
      COALESCE((line_item->>'total_workload_hours_impact')::numeric, 0),
      COALESCE((line_item->>'forecast_budget_amount')::numeric, 0),
      COALESCE((line_item->>'forecast_labour_cost')::numeric, 0),
      COALESCE((line_item->>'forecast_required_fte')::numeric, 0),
      COALESCE((line_item->>'forecast_workload_hours')::numeric, 0),
      target_reforecast.created_by
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_reforecast_driver_impacts(
  target_organisation_id uuid,
  target_reforecast record,
  impact_payloads jsonb
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  impact_item jsonb;
  impact_count integer := 0;
BEGIN
  IF impact_payloads IS NULL OR jsonb_typeof(impact_payloads) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR impact_item IN SELECT * FROM jsonb_array_elements(impact_payloads)
  LOOP
    IF COALESCE(impact_item->>'driver_status_at_calculation', 'approved') <> 'approved' THEN
      RAISE EXCEPTION 'Only approved drivers can feed the official forecast';
    END IF;
    INSERT INTO public.reforecast_driver_impacts (
      organisation_id, reforecast_id, forecast_driver_id,
      driver_code, driver_name, category, impact_type, annual_impact_amount,
      driver_status_at_calculation, created_by
    ) VALUES (
      target_organisation_id,
      target_reforecast.id,
      (impact_item->>'forecast_driver_id')::uuid,
      impact_item->>'driver_code',
      impact_item->>'driver_name',
      impact_item->>'category',
      impact_item->>'impact_type',
      COALESCE((impact_item->>'annual_impact_amount')::numeric, 0),
      'approved',
      target_reforecast.created_by
    );
    impact_count := impact_count + 1;
  END LOOP;

  RETURN impact_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: create a draft reforecast from a locked budget baseline
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- RPC: recalculate a draft reforecast
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- RPC: governed status transitions (submit, revert, void)
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- RPC: immutable forecast lock with snapshot and supersession
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Lock down the governance surface to the server-side service role only
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.create_reforecast(uuid, uuid, jsonb, jsonb, jsonb, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_reforecast(uuid, uuid, uuid, jsonb, jsonb, jsonb, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_reforecast_status(uuid, uuid, uuid, text, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.lock_reforecast(uuid, uuid, uuid, jsonb, text, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_reforecast_lines_consistent(jsonb) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.insert_reforecast_lines(uuid, record, jsonb) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.insert_reforecast_driver_impacts(uuid, record, jsonb) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_reforecast(uuid, uuid, jsonb, jsonb, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_reforecast(uuid, uuid, uuid, jsonb, jsonb, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_reforecast_status(uuid, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_reforecast(uuid, uuid, uuid, jsonb, text, text) TO service_role;
