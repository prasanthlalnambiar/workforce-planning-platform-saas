-- Workforce Planning and Labour Budget Governance Platform
-- Phase 5 Driver Layer
-- Scope: locked budget baseline -> governed driver lifecycle -> scenario preview and approved official impact.
-- No reforecast locks, actuals, variance, waterfall or AI.

CREATE TABLE public.budget_driver_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  budget_baseline_id uuid NOT NULL,
  driver_set_name text NOT NULL,
  driver_set_type text NOT NULL DEFAULT 'planning_adjustment' CHECK (driver_set_type IN ('planning_adjustment')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'proposed', 'approved', 'superseded', 'voided')),
  source_baseline_checksum text,
  source_baseline_locked_at timestamptz,
  total_budget_delta numeric(18,2) NOT NULL DEFAULT 0,
  total_labour_cost_delta numeric(18,2) NOT NULL DEFAULT 0,
  total_required_fte_delta numeric(12,2) NOT NULL DEFAULT 0,
  total_workload_hours_delta numeric(14,2) NOT NULL DEFAULT 0,
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  is_immutable boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  CONSTRAINT budget_driver_sets_baseline_same_org_fk FOREIGN KEY (organisation_id, budget_baseline_id) REFERENCES public.budget_baselines(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT budget_driver_sets_plan_same_org_fk FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT budget_driver_sets_fiscal_year_same_org_fk FOREIGN KEY (organisation_id, fiscal_year_id) REFERENCES public.fiscal_years(organisation_id, id) ON DELETE CASCADE
);

CREATE TABLE public.budget_drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  driver_set_id uuid NOT NULL,
  budget_baseline_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  driver_name text NOT NULL,
  driver_category text NOT NULL CHECK (driver_category IN (
    'growth',
    'efficiency',
    'cost_change',
    'supply_change',
    'management_adjustment'
  )),
  driver_direction text NOT NULL CHECK (driver_direction IN ('increase', 'decrease')),
  impact_basis text NOT NULL CHECK (impact_basis IN ('budget_amount', 'labour_cost', 'required_fte', 'workload_hours', 'multi_metric')),
  phasing_method text NOT NULL DEFAULT 'straight_line' CHECK (phasing_method IN ('straight_line', 'ramp_up', 'ramp_down', 'one_off')),
  annual_budget_delta numeric(18,2) NOT NULL DEFAULT 0,
  annual_labour_cost_delta numeric(18,2) NOT NULL DEFAULT 0,
  annual_required_fte_delta numeric(12,2) NOT NULL DEFAULT 0,
  annual_workload_hours_delta numeric(14,2) NOT NULL DEFAULT 0,
  confidence_score numeric(5,2),
  evidence_quality_score numeric(5,2),
  risk_rating text NOT NULL DEFAULT 'medium' CHECK (risk_rating IN ('low', 'medium', 'high')),
  rationale text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'proposed', 'approved', 'superseded', 'voided')),
  proposed_by uuid REFERENCES public.profiles(id),
  proposed_at timestamptz,
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  superseded_by uuid REFERENCES public.profiles(id),
  superseded_at timestamptz,
  voided_by uuid REFERENCES public.profiles(id),
  voided_at timestamptz,
  supersedes_driver_id uuid,
  superseded_by_driver_id uuid,
  is_immutable boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  CONSTRAINT budget_drivers_confidence_score_range CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100),
  CONSTRAINT budget_drivers_evidence_quality_score_range CHECK (evidence_quality_score IS NULL OR evidence_quality_score BETWEEN 0 AND 100),
  CONSTRAINT budget_drivers_non_zero_delta CHECK (
    annual_budget_delta <> 0
    OR annual_labour_cost_delta <> 0
    OR annual_required_fte_delta <> 0
    OR annual_workload_hours_delta <> 0
  ),
  CONSTRAINT budget_drivers_set_same_org_fk FOREIGN KEY (organisation_id, driver_set_id) REFERENCES public.budget_driver_sets(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT budget_drivers_baseline_same_org_fk FOREIGN KEY (organisation_id, budget_baseline_id) REFERENCES public.budget_baselines(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT budget_drivers_plan_same_org_fk FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT budget_drivers_fiscal_year_same_org_fk FOREIGN KEY (organisation_id, fiscal_year_id) REFERENCES public.fiscal_years(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT budget_drivers_supersedes_same_org_fk FOREIGN KEY (organisation_id, supersedes_driver_id) REFERENCES public.budget_drivers(organisation_id, id),
  CONSTRAINT budget_drivers_superseded_by_same_org_fk FOREIGN KEY (organisation_id, superseded_by_driver_id) REFERENCES public.budget_drivers(organisation_id, id)
);

CREATE TABLE public.budget_driver_monthly_impacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  driver_set_id uuid NOT NULL,
  budget_driver_id uuid NOT NULL,
  budget_baseline_id uuid NOT NULL,
  budget_baseline_line_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  period_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  budget_delta numeric(18,2) NOT NULL DEFAULT 0,
  labour_cost_delta numeric(18,2) NOT NULL DEFAULT 0,
  required_fte_delta numeric(12,2) NOT NULL DEFAULT 0,
  workload_hours_delta numeric(14,2) NOT NULL DEFAULT 0,
  phasing_method text NOT NULL DEFAULT 'straight_line' CHECK (phasing_method IN ('straight_line', 'ramp_up', 'ramp_down', 'one_off')),
  impact_treatment text NOT NULL DEFAULT 'draft_preview' CHECK (impact_treatment IN ('draft_preview', 'scenario_preview', 'official_impact', 'excluded')),
  notes text,
  is_immutable boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, budget_driver_id, period_id),
  CONSTRAINT budget_driver_impacts_set_same_org_fk FOREIGN KEY (organisation_id, driver_set_id) REFERENCES public.budget_driver_sets(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT budget_driver_impacts_driver_same_org_fk FOREIGN KEY (organisation_id, budget_driver_id) REFERENCES public.budget_drivers(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT budget_driver_impacts_baseline_same_org_fk FOREIGN KEY (organisation_id, budget_baseline_id) REFERENCES public.budget_baselines(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT budget_driver_impacts_baseline_line_same_org_fk FOREIGN KEY (organisation_id, budget_baseline_line_id) REFERENCES public.budget_baseline_lines(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT budget_driver_impacts_plan_same_org_fk FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT budget_driver_impacts_fiscal_year_same_org_fk FOREIGN KEY (organisation_id, fiscal_year_id) REFERENCES public.fiscal_years(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT budget_driver_impacts_period_same_org_fk FOREIGN KEY (organisation_id, period_id) REFERENCES public.planning_periods(organisation_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_budget_driver_sets_baseline ON public.budget_driver_sets(organisation_id, budget_baseline_id, created_at DESC);
CREATE INDEX idx_budget_drivers_set ON public.budget_drivers(organisation_id, driver_set_id, created_at DESC);
CREATE INDEX idx_budget_driver_impacts_driver ON public.budget_driver_monthly_impacts(organisation_id, budget_driver_id, period_start);
CREATE INDEX idx_budget_driver_impacts_set_period ON public.budget_driver_monthly_impacts(organisation_id, driver_set_id, period_start);

CREATE TRIGGER budget_driver_sets_set_updated_at BEFORE UPDATE ON public.budget_driver_sets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER budget_drivers_set_updated_at BEFORE UPDATE ON public.budget_drivers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER budget_driver_impacts_set_updated_at BEFORE UPDATE ON public.budget_driver_monthly_impacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.budget_driver_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_driver_monthly_impacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY budget_driver_sets_select_member ON public.budget_driver_sets
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY budget_drivers_select_member ON public.budget_drivers
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY budget_driver_monthly_impacts_select_member ON public.budget_driver_monthly_impacts
  FOR SELECT USING (public.is_org_member(organisation_id));

-- Driver writes are routed through server-side services and controlled RPCs so locked-baseline
-- provenance, tenant scope, review immutability and audit events cannot be bypassed from the browser.
REVOKE INSERT, UPDATE, DELETE ON public.budget_driver_sets FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.budget_drivers FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.budget_driver_monthly_impacts FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.protect_budget_driver_set_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.driver_lifecycle_transition', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.is_immutable = true OR OLD.status IN ('approved', 'superseded', 'voided') THEN
      RAISE EXCEPTION 'Approved budget driver sets cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_immutable = true OR OLD.status IN ('approved', 'superseded', 'voided') THEN
    RAISE EXCEPTION 'Approved budget driver sets cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_budget_driver_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
BEGIN
  IF current_setting('app.driver_lifecycle_transition', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT status INTO parent_status FROM public.budget_driver_sets WHERE organisation_id = OLD.organisation_id AND id = OLD.driver_set_id;
    IF OLD.is_immutable = true OR OLD.status <> 'draft' OR parent_status IN ('approved', 'superseded', 'voided') THEN
      RAISE EXCEPTION 'Approved budget drivers cannot be deleted; they must be superseded or voided through the lifecycle RPC';
    END IF;
    RETURN OLD;
  END IF;

  SELECT status INTO parent_status FROM public.budget_driver_sets WHERE organisation_id = OLD.organisation_id AND id = OLD.driver_set_id;
  IF OLD.is_immutable = true OR OLD.status <> 'draft' OR parent_status IN ('approved', 'superseded', 'voided') THEN
    RAISE EXCEPTION 'Only draft budget drivers can be edited directly; approved drivers must be superseded';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_budget_driver_monthly_impact_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
  driver_status text;
BEGIN
  IF current_setting('app.driver_lifecycle_transition', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT status INTO parent_status FROM public.budget_driver_sets WHERE organisation_id = OLD.organisation_id AND id = OLD.driver_set_id;
    SELECT status INTO driver_status FROM public.budget_drivers WHERE organisation_id = OLD.organisation_id AND id = OLD.budget_driver_id;
    IF OLD.is_immutable = true OR driver_status <> 'draft' OR parent_status IN ('approved', 'superseded', 'voided') THEN
      RAISE EXCEPTION 'Approved budget driver monthly impacts cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  SELECT status INTO parent_status FROM public.budget_driver_sets WHERE organisation_id = OLD.organisation_id AND id = OLD.driver_set_id;
  SELECT status INTO driver_status FROM public.budget_drivers WHERE organisation_id = OLD.organisation_id AND id = OLD.budget_driver_id;
  IF OLD.is_immutable = true OR driver_status <> 'draft' OR parent_status IN ('approved', 'superseded', 'voided') THEN
    RAISE EXCEPTION 'Only draft budget driver monthly impacts can be edited directly';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_budget_driver_set_update
BEFORE UPDATE OR DELETE ON public.budget_driver_sets
FOR EACH ROW EXECUTE FUNCTION public.protect_budget_driver_set_update();

CREATE TRIGGER protect_budget_driver_update
BEFORE UPDATE OR DELETE ON public.budget_drivers
FOR EACH ROW EXECUTE FUNCTION public.protect_budget_driver_update();

CREATE TRIGGER protect_budget_driver_monthly_impact_update
BEFORE UPDATE OR DELETE ON public.budget_driver_monthly_impacts
FOR EACH ROW EXECUTE FUNCTION public.protect_budget_driver_monthly_impact_update();

CREATE OR REPLACE FUNCTION public.create_budget_driver_set_from_baseline(
  target_organisation_id uuid,
  target_budget_baseline_id uuid,
  target_actor_user_id uuid,
  driver_set_payload jsonb,
  create_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  source_baseline public.budget_baselines%ROWTYPE;
  new_driver_set public.budget_driver_sets%ROWTYPE;
BEGIN
  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin', 'planner']) THEN
    RAISE EXCEPTION 'Insufficient permission to create budget driver set';
  END IF;

  SELECT * INTO source_baseline
  FROM public.budget_baselines
  WHERE organisation_id = target_organisation_id
    AND id = target_budget_baseline_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget baseline not found for driver set';
  END IF;

  IF source_baseline.status <> 'locked' OR source_baseline.is_immutable IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Only locked immutable budget baselines can source budget driver sets';
  END IF;

  INSERT INTO public.budget_driver_sets (
    organisation_id,
    plan_id,
    fiscal_year_id,
    budget_baseline_id,
    driver_set_name,
    source_baseline_checksum,
    source_baseline_locked_at,
    notes,
    created_by
  ) VALUES (
    target_organisation_id,
    source_baseline.plan_id,
    source_baseline.fiscal_year_id,
    source_baseline.id,
    COALESCE(NULLIF(driver_set_payload->>'driver_set_name', ''), source_baseline.baseline_name || ' driver set'),
    source_baseline.checksum,
    source_baseline.locked_at,
    driver_set_payload->>'notes',
    target_actor_user_id
  ) RETURNING * INTO new_driver_set;

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    new_value_json, reason
  ) VALUES (
    target_organisation_id,
    target_actor_user_id,
    'budget_driver_set.created_from_locked_baseline',
    'budget_driver_set',
    new_driver_set.id,
    new_driver_set.plan_id,
    new_driver_set.fiscal_year_id,
    jsonb_build_object('driver_set', to_jsonb(new_driver_set), 'source_baseline_id', source_baseline.id),
    COALESCE(create_reason, 'Budget driver set created from locked baseline')
  );

  RETURN to_jsonb(new_driver_set);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_budget_driver(
  target_organisation_id uuid,
  target_driver_set_id uuid,
  target_actor_user_id uuid,
  driver_payload jsonb,
  impact_payloads jsonb,
  create_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_set public.budget_driver_sets%ROWTYPE;
  source_baseline public.budget_baselines%ROWTYPE;
  new_driver public.budget_drivers%ROWTYPE;
  inserted_impacts jsonb;
  impact_item jsonb;
  impact_count int;
BEGIN
  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin', 'planner']) THEN
    RAISE EXCEPTION 'Insufficient permission to create budget driver';
  END IF;

  SELECT * INTO target_set
  FROM public.budget_driver_sets
  WHERE organisation_id = target_organisation_id
    AND id = target_driver_set_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget driver set not found';
  END IF;

  IF target_set.status NOT IN ('draft', 'proposed') OR target_set.is_immutable = true THEN
    RAISE EXCEPTION 'Only draft budget driver sets can be edited';
  END IF;

  SELECT * INTO source_baseline
  FROM public.budget_baselines
  WHERE organisation_id = target_organisation_id
    AND id = target_set.budget_baseline_id;

  IF NOT FOUND OR source_baseline.status <> 'locked' OR source_baseline.is_immutable IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Budget drivers require a locked immutable budget baseline';
  END IF;

  SELECT jsonb_array_length(impact_payloads) INTO impact_count;
  IF impact_count <> 12 THEN
    RAISE EXCEPTION 'Budget drivers require 12 monthly impact rows';
  END IF;

  INSERT INTO public.budget_drivers (
    organisation_id,
    driver_set_id,
    budget_baseline_id,
    plan_id,
    fiscal_year_id,
    driver_name,
    driver_category,
    driver_direction,
    impact_basis,
    phasing_method,
    annual_budget_delta,
    annual_labour_cost_delta,
    annual_required_fte_delta,
    annual_workload_hours_delta,
    confidence_score,
    evidence_quality_score,
    risk_rating,
    rationale,
    supersedes_driver_id,
    created_by
  ) VALUES (
    target_organisation_id,
    target_set.id,
    target_set.budget_baseline_id,
    target_set.plan_id,
    target_set.fiscal_year_id,
    driver_payload->>'driver_name',
    driver_payload->>'driver_category',
    driver_payload->>'driver_direction',
    driver_payload->>'impact_basis',
    COALESCE(driver_payload->>'phasing_method', 'straight_line'),
    COALESCE(NULLIF(driver_payload->>'annual_budget_delta', '')::numeric, 0),
    COALESCE(NULLIF(driver_payload->>'annual_labour_cost_delta', '')::numeric, 0),
    COALESCE(NULLIF(driver_payload->>'annual_required_fte_delta', '')::numeric, 0),
    COALESCE(NULLIF(driver_payload->>'annual_workload_hours_delta', '')::numeric, 0),
    NULLIF(driver_payload->>'confidence_score', '')::numeric,
    NULLIF(driver_payload->>'evidence_quality_score', '')::numeric,
    COALESCE(driver_payload->>'risk_rating', 'medium'),
    driver_payload->>'rationale',
    NULLIF(driver_payload->>'supersedes_driver_id', '')::uuid,
    target_actor_user_id
  ) RETURNING * INTO new_driver;

  FOR impact_item IN SELECT * FROM jsonb_array_elements(impact_payloads)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.budget_baseline_lines baseline_line
      WHERE baseline_line.organisation_id = target_organisation_id
        AND baseline_line.budget_baseline_id = target_set.budget_baseline_id
        AND baseline_line.id = (impact_item->>'budget_baseline_line_id')::uuid
        AND baseline_line.period_id = (impact_item->>'period_id')::uuid
        AND baseline_line.period_start = (impact_item->>'period_start')::date
        AND baseline_line.period_end = (impact_item->>'period_end')::date
    ) THEN
      RAISE EXCEPTION 'Budget driver impact row does not match the locked baseline period';
    END IF;

    INSERT INTO public.budget_driver_monthly_impacts (
      organisation_id,
      driver_set_id,
      budget_driver_id,
      budget_baseline_id,
      budget_baseline_line_id,
      plan_id,
      fiscal_year_id,
      period_id,
      period_start,
      period_end,
      budget_delta,
      labour_cost_delta,
      required_fte_delta,
      workload_hours_delta,
      phasing_method,
      impact_treatment,
      notes,
      created_by
    ) VALUES (
      target_organisation_id,
      target_set.id,
      new_driver.id,
      target_set.budget_baseline_id,
      (impact_item->>'budget_baseline_line_id')::uuid,
      target_set.plan_id,
      target_set.fiscal_year_id,
      (impact_item->>'period_id')::uuid,
      (impact_item->>'period_start')::date,
      (impact_item->>'period_end')::date,
      COALESCE(NULLIF(impact_item->>'budget_delta', '')::numeric, 0),
      COALESCE(NULLIF(impact_item->>'labour_cost_delta', '')::numeric, 0),
      COALESCE(NULLIF(impact_item->>'required_fte_delta', '')::numeric, 0),
      COALESCE(NULLIF(impact_item->>'workload_hours_delta', '')::numeric, 0),
      COALESCE(impact_item->>'phasing_method', 'straight_line'),
      'draft_preview',
      impact_item->>'notes',
      target_actor_user_id
    );
  END LOOP;

  SELECT COALESCE(jsonb_agg(to_jsonb(impact_rows) ORDER BY impact_rows.period_start), '[]'::jsonb)
  INTO inserted_impacts
  FROM public.budget_driver_monthly_impacts impact_rows
  WHERE impact_rows.organisation_id = target_organisation_id
    AND impact_rows.budget_driver_id = new_driver.id;

  PERFORM public.refresh_budget_driver_set_totals(target_organisation_id, target_set.id);

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    new_value_json, reason
  ) VALUES (
    target_organisation_id,
    target_actor_user_id,
    'budget_driver.created',
    'budget_driver',
    new_driver.id,
    target_set.plan_id,
    target_set.fiscal_year_id,
    jsonb_build_object('driver', to_jsonb(new_driver), 'monthly_impacts', inserted_impacts),
    COALESCE(create_reason, 'Budget driver created')
  );

  RETURN jsonb_build_object('driver', to_jsonb(new_driver), 'monthly_impacts', inserted_impacts);
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_budget_driver_set_totals(
  target_organisation_id uuid,
  target_driver_set_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  driver_count int;
  proposed_count int;
  budget_total numeric;
  labour_total numeric;
  fte_total numeric;
  workload_total numeric;
  proposed_budget_total numeric;
  proposed_labour_total numeric;
  proposed_fte_total numeric;
  proposed_workload_total numeric;
BEGIN
  SELECT COUNT(*)
  INTO driver_count
  FROM public.budget_drivers
  WHERE organisation_id = target_organisation_id
    AND driver_set_id = target_driver_set_id
    AND status = 'approved';

  SELECT COUNT(*)
  INTO proposed_count
  FROM public.budget_drivers
  WHERE organisation_id = target_organisation_id
    AND driver_set_id = target_driver_set_id
    AND status = 'proposed';

  SELECT
    COALESCE(SUM(impact_rows.budget_delta), 0),
    COALESCE(SUM(impact_rows.labour_cost_delta), 0),
    COALESCE(SUM(impact_rows.required_fte_delta), 0),
    COALESCE(SUM(impact_rows.workload_hours_delta), 0)
  INTO budget_total, labour_total, fte_total, workload_total
  FROM public.budget_driver_monthly_impacts impact_rows
  INNER JOIN public.budget_drivers drivers
    ON drivers.organisation_id = impact_rows.organisation_id
   AND drivers.id = impact_rows.budget_driver_id
  WHERE impact_rows.organisation_id = target_organisation_id
    AND impact_rows.driver_set_id = target_driver_set_id
    AND drivers.status = 'approved'
    AND impact_rows.impact_treatment = 'official_impact';

  SELECT
    COALESCE(SUM(impact_rows.budget_delta), 0),
    COALESCE(SUM(impact_rows.labour_cost_delta), 0),
    COALESCE(SUM(impact_rows.required_fte_delta), 0),
    COALESCE(SUM(impact_rows.workload_hours_delta), 0)
  INTO proposed_budget_total, proposed_labour_total, proposed_fte_total, proposed_workload_total
  FROM public.budget_driver_monthly_impacts impact_rows
  INNER JOIN public.budget_drivers drivers
    ON drivers.organisation_id = impact_rows.organisation_id
   AND drivers.id = impact_rows.budget_driver_id
  WHERE impact_rows.organisation_id = target_organisation_id
    AND impact_rows.driver_set_id = target_driver_set_id
    AND drivers.status = 'proposed'
    AND impact_rows.impact_treatment = 'scenario_preview';

  UPDATE public.budget_driver_sets
  SET total_budget_delta = budget_total,
      total_labour_cost_delta = labour_total,
      total_required_fte_delta = fte_total,
      total_workload_hours_delta = workload_total,
      summary_json = jsonb_build_object(
        'approved_driver_count', driver_count,
        'proposed_driver_count', proposed_count,
        'official_budget_delta', budget_total,
        'official_labour_cost_delta', labour_total,
        'official_required_fte_delta', fte_total,
        'official_workload_hours_delta', workload_total,
        'proposed_scenario_budget_delta', proposed_budget_total,
        'proposed_scenario_labour_cost_delta', proposed_labour_total,
        'proposed_scenario_required_fte_delta', proposed_fte_total,
        'proposed_scenario_workload_hours_delta', proposed_workload_total
      )
  WHERE organisation_id = target_organisation_id
    AND id = target_driver_set_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_budget_driver_set(
  target_organisation_id uuid,
  target_driver_set_id uuid,
  target_actor_user_id uuid,
  review_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_set public.budget_driver_sets%ROWTYPE;
  reviewed_set public.budget_driver_sets%ROWTYPE;
  driver_count int;
  review_time timestamptz;
BEGIN
  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin', 'reviewer']) THEN
    RAISE EXCEPTION 'Insufficient permission to review budget driver set';
  END IF;

  SELECT * INTO target_set
  FROM public.budget_driver_sets
  WHERE organisation_id = target_organisation_id
    AND id = target_driver_set_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget driver set not found';
  END IF;

  IF target_set.status <> 'draft' OR target_set.is_immutable = true THEN
    RAISE EXCEPTION 'Only draft budget driver sets can be reviewed';
  END IF;

  SELECT COUNT(*) INTO driver_count
  FROM public.budget_drivers
  WHERE organisation_id = target_organisation_id
    AND driver_set_id = target_driver_set_id
    AND status IN ('proposed', 'approved');

  IF driver_count = 0 THEN
    RAISE EXCEPTION 'Budget driver set requires at least one proposed or approved driver before review';
  END IF;

  review_time := now();

  PERFORM public.refresh_budget_driver_set_totals(target_organisation_id, target_driver_set_id);

  PERFORM set_config('app.driver_lifecycle_transition', 'on', true);
  UPDATE public.budget_driver_sets
  SET status = 'proposed',
      reviewed_by = target_actor_user_id,
      reviewed_at = review_time
  WHERE organisation_id = target_organisation_id
    AND id = target_driver_set_id
  RETURNING * INTO reviewed_set;

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    new_value_json, reason
  ) VALUES (
    target_organisation_id,
    target_actor_user_id,
    'budget_driver_set.reviewed',
    'budget_driver_set',
    target_driver_set_id,
    reviewed_set.plan_id,
    reviewed_set.fiscal_year_id,
    to_jsonb(reviewed_set),
    COALESCE(review_reason, 'Budget driver set reviewed')
  );

  RETURN to_jsonb(reviewed_set);
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_budget_driver_lifecycle(
  target_organisation_id uuid,
  target_budget_driver_id uuid,
  target_actor_user_id uuid,
  next_status text,
  transition_payload jsonb DEFAULT '{}'::jsonb,
  transition_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_driver public.budget_drivers%ROWTYPE;
  updated_driver public.budget_drivers%ROWTYPE;
  treatment text;
  transition_time timestamptz;
BEGIN
  IF next_status NOT IN ('proposed', 'approved', 'superseded', 'voided') THEN
    RAISE EXCEPTION 'Unsupported budget driver lifecycle status';
  END IF;

  SELECT * INTO current_driver
  FROM public.budget_drivers
  WHERE organisation_id = target_organisation_id
    AND id = target_budget_driver_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget driver not found';
  END IF;

  IF next_status = 'proposed' THEN
    IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin', 'planner']) THEN
      RAISE EXCEPTION 'Insufficient permission to propose budget driver';
    END IF;
    IF current_driver.status <> 'draft' THEN
      RAISE EXCEPTION 'Only draft budget drivers can be proposed';
    END IF;
    treatment := 'scenario_preview';
  ELSIF next_status = 'approved' THEN
    IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin', 'reviewer']) THEN
      RAISE EXCEPTION 'Insufficient permission to approve budget driver';
    END IF;
    IF current_driver.status <> 'proposed' THEN
      RAISE EXCEPTION 'Only proposed budget drivers can be approved';
    END IF;
    treatment := 'official_impact';
  ELSIF next_status = 'superseded' THEN
    IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin', 'reviewer']) THEN
      RAISE EXCEPTION 'Insufficient permission to supersede budget driver';
    END IF;
    IF current_driver.status <> 'approved' THEN
      RAISE EXCEPTION 'Only approved budget drivers can be superseded';
    END IF;
    treatment := 'excluded';
  ELSE
    IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin', 'planner', 'reviewer']) THEN
      RAISE EXCEPTION 'Insufficient permission to void budget driver';
    END IF;
    IF current_driver.status NOT IN ('draft', 'proposed') THEN
      RAISE EXCEPTION 'Approved budget drivers must be superseded, not voided';
    END IF;
    treatment := 'excluded';
  END IF;

  transition_time := now();
  PERFORM set_config('app.driver_lifecycle_transition', 'on', true);

  UPDATE public.budget_driver_monthly_impacts
  SET impact_treatment = treatment,
      is_immutable = next_status IN ('approved', 'superseded', 'voided')
  WHERE organisation_id = target_organisation_id
    AND budget_driver_id = target_budget_driver_id;

  UPDATE public.budget_drivers
  SET status = next_status,
      is_immutable = next_status IN ('approved', 'superseded', 'voided'),
      proposed_by = CASE WHEN next_status = 'proposed' THEN target_actor_user_id ELSE proposed_by END,
      proposed_at = CASE WHEN next_status = 'proposed' THEN transition_time ELSE proposed_at END,
      approved_by = CASE WHEN next_status = 'approved' THEN target_actor_user_id ELSE approved_by END,
      approved_at = CASE WHEN next_status = 'approved' THEN transition_time ELSE approved_at END,
      superseded_by = CASE WHEN next_status = 'superseded' THEN target_actor_user_id ELSE superseded_by END,
      superseded_at = CASE WHEN next_status = 'superseded' THEN transition_time ELSE superseded_at END,
      voided_by = CASE WHEN next_status = 'voided' THEN target_actor_user_id ELSE voided_by END,
      voided_at = CASE WHEN next_status = 'voided' THEN transition_time ELSE voided_at END,
      superseded_by_driver_id = COALESCE(NULLIF(transition_payload->>'superseded_by_driver_id', '')::uuid, superseded_by_driver_id)
  WHERE organisation_id = target_organisation_id
    AND id = target_budget_driver_id
  RETURNING * INTO updated_driver;

  PERFORM public.refresh_budget_driver_set_totals(target_organisation_id, current_driver.driver_set_id);

  INSERT INTO public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, plan_id, fiscal_year_id,
    old_value_json, new_value_json, reason
  ) VALUES (
    target_organisation_id,
    target_actor_user_id,
    CASE
      WHEN next_status = 'proposed' THEN 'budget_driver.proposed'
      WHEN next_status = 'approved' THEN 'budget_driver.approved'
      WHEN next_status = 'superseded' THEN 'budget_driver.superseded'
      ELSE 'budget_driver.voided'
    END,
    'budget_driver',
    target_budget_driver_id,
    updated_driver.plan_id,
    updated_driver.fiscal_year_id,
    jsonb_build_object('status', current_driver.status),
    jsonb_build_object('status', updated_driver.status, 'impact_treatment', treatment),
    COALESCE(transition_reason, 'Budget driver lifecycle transition')
  );

  RETURN to_jsonb(updated_driver);
END;
$$;

REVOKE ALL ON FUNCTION public.create_budget_driver_set_from_baseline(uuid, uuid, uuid, jsonb, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.create_budget_driver(uuid, uuid, uuid, jsonb, jsonb, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.review_budget_driver_set(uuid, uuid, uuid, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_budget_driver_lifecycle(uuid, uuid, uuid, text, jsonb, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_budget_driver_set_totals(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_budget_driver_set_from_baseline(uuid, uuid, uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_budget_driver(uuid, uuid, uuid, jsonb, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_budget_driver_set(uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_budget_driver_lifecycle(uuid, uuid, uuid, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_budget_driver_set_totals(uuid, uuid) TO service_role;
