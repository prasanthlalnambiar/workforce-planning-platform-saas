-- Workforce Planning and Labour Budget Governance Platform
-- Phase 4 Budget Baseline Module
-- Scope: budget baseline creation, monthly phasing, review, immutable lock and snapshot only.
-- No drivers, reforecasting, actuals, variance, waterfall or AI.

ALTER TABLE public.layer1_handoff_objects
  ADD CONSTRAINT layer1_handoff_objects_org_id_unique UNIQUE (organisation_id, id);

CREATE TABLE public.budget_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  baseline_name text NOT NULL,
  baseline_type text NOT NULL DEFAULT 'annual_labour_opex',
  source_type text NOT NULL CHECK (source_type IN ('layer1_handoff', 'manual')),
  source_layer1_handoff_id uuid,
  source_layer1_version_lock_id uuid,
  annual_budget_amount numeric(18,2) NOT NULL DEFAULT 0,
  annual_required_fte numeric(12,2) NOT NULL DEFAULT 0,
  annual_workload_hours numeric(14,2) NOT NULL DEFAULT 0,
  annual_labour_cost numeric(18,2) NOT NULL DEFAULT 0,
  annual_supply_gap_fte numeric(12,2) NOT NULL DEFAULT 0,
  source_quality_score numeric(5,2),
  confidence_score numeric(5,2),
  key_assumptions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_summary_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  scenario_summary_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  annualisation_note text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'locked', 'superseded', 'voided')),
  locked_by uuid REFERENCES public.profiles(id),
  locked_at timestamptz,
  checksum text,
  notes text,
  is_immutable boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  CONSTRAINT budget_baselines_plan_same_org_fk FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT budget_baselines_fiscal_year_same_org_fk FOREIGN KEY (organisation_id, fiscal_year_id) REFERENCES public.fiscal_years(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT budget_baselines_handoff_same_org_fk FOREIGN KEY (organisation_id, source_layer1_handoff_id) REFERENCES public.layer1_handoff_objects(organisation_id, id),
  CONSTRAINT budget_baselines_version_lock_same_org_fk FOREIGN KEY (organisation_id, source_layer1_version_lock_id) REFERENCES public.layer1_version_locks(organisation_id, id)
);

CREATE TABLE public.budget_baseline_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  budget_baseline_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  period_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  workload_hours numeric(14,2) NOT NULL DEFAULT 0,
  required_fte numeric(12,2) NOT NULL DEFAULT 0,
  supply_gap_fte numeric(12,2) NOT NULL DEFAULT 0,
  labour_cost numeric(18,2) NOT NULL DEFAULT 0,
  budget_amount numeric(18,2) NOT NULL DEFAULT 0,
  phasing_method text NOT NULL DEFAULT 'straight_line' CHECK (phasing_method IN ('straight_line', 'custom_manual', 'working_days_weighted', 'imported_from_layer1')),
  source_category text NOT NULL DEFAULT 'manual' CHECK (source_category IN ('layer1_handoff', 'manual')),
  notes text,
  is_immutable boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, budget_baseline_id, period_id),
  CONSTRAINT budget_baseline_lines_baseline_same_org_fk FOREIGN KEY (organisation_id, budget_baseline_id) REFERENCES public.budget_baselines(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT budget_baseline_lines_plan_same_org_fk FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT budget_baseline_lines_fiscal_year_same_org_fk FOREIGN KEY (organisation_id, fiscal_year_id) REFERENCES public.fiscal_years(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT budget_baseline_lines_period_same_org_fk FOREIGN KEY (organisation_id, period_id) REFERENCES public.planning_periods(organisation_id, id) ON DELETE CASCADE
);

CREATE TABLE public.budget_baseline_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  budget_baseline_id uuid NOT NULL,
  snapshot_json jsonb NOT NULL,
  checksum text NOT NULL,
  locked_by uuid REFERENCES public.profiles(id),
  locked_at timestamptz NOT NULL DEFAULT now(),
  is_immutable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  CONSTRAINT budget_baseline_snapshots_baseline_same_org_fk FOREIGN KEY (organisation_id, budget_baseline_id) REFERENCES public.budget_baselines(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT budget_baseline_snapshots_plan_same_org_fk FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT budget_baseline_snapshots_fiscal_year_same_org_fk FOREIGN KEY (organisation_id, fiscal_year_id) REFERENCES public.fiscal_years(organisation_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX budget_baselines_one_locked_per_plan_fy
  ON public.budget_baselines(organisation_id, plan_id, fiscal_year_id)
  WHERE status = 'locked';

CREATE INDEX idx_budget_baselines_org_plan_fy ON public.budget_baselines(organisation_id, plan_id, fiscal_year_id, created_at DESC);
CREATE INDEX idx_budget_baseline_lines_baseline ON public.budget_baseline_lines(organisation_id, budget_baseline_id, period_start);
CREATE INDEX idx_budget_baseline_snapshots_baseline ON public.budget_baseline_snapshots(organisation_id, budget_baseline_id, locked_at DESC);

CREATE TRIGGER budget_baselines_set_updated_at BEFORE UPDATE ON public.budget_baselines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER budget_baseline_lines_set_updated_at BEFORE UPDATE ON public.budget_baseline_lines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.budget_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_baseline_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_baseline_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY budget_baselines_select_member ON public.budget_baselines
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY budget_baseline_lines_select_member ON public.budget_baseline_lines
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY budget_baseline_snapshots_select_member ON public.budget_baseline_snapshots
  FOR SELECT USING (public.is_org_member(organisation_id));

-- Budget baseline writes are routed through server-side services and controlled RPCs so audit, tenant
-- consistency and immutable handoff transitions cannot be bypassed from the browser.

CREATE OR REPLACE FUNCTION public.protect_budget_baseline_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_immutable = true OR OLD.status = 'locked' THEN
      RAISE EXCEPTION 'Locked budget baselines cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_immutable = true OR OLD.status = 'locked' THEN
    IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
      OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
      OR NEW.fiscal_year_id IS DISTINCT FROM OLD.fiscal_year_id
      OR NEW.baseline_name IS DISTINCT FROM OLD.baseline_name
      OR NEW.baseline_type IS DISTINCT FROM OLD.baseline_type
      OR NEW.source_type IS DISTINCT FROM OLD.source_type
      OR NEW.source_layer1_handoff_id IS DISTINCT FROM OLD.source_layer1_handoff_id
      OR NEW.source_layer1_version_lock_id IS DISTINCT FROM OLD.source_layer1_version_lock_id
      OR NEW.annual_budget_amount IS DISTINCT FROM OLD.annual_budget_amount
      OR NEW.annual_required_fte IS DISTINCT FROM OLD.annual_required_fte
      OR NEW.annual_workload_hours IS DISTINCT FROM OLD.annual_workload_hours
      OR NEW.annual_labour_cost IS DISTINCT FROM OLD.annual_labour_cost
      OR NEW.annual_supply_gap_fte IS DISTINCT FROM OLD.annual_supply_gap_fte
      OR NEW.source_quality_score IS DISTINCT FROM OLD.source_quality_score
      OR NEW.confidence_score IS DISTINCT FROM OLD.confidence_score
      OR NEW.key_assumptions_json IS DISTINCT FROM OLD.key_assumptions_json
      OR NEW.risk_summary_json IS DISTINCT FROM OLD.risk_summary_json
      OR NEW.scenario_summary_json IS DISTINCT FROM OLD.scenario_summary_json
      OR NEW.annualisation_note IS DISTINCT FROM OLD.annualisation_note
      OR NEW.locked_by IS DISTINCT FROM OLD.locked_by
      OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
      OR NEW.checksum IS DISTINCT FROM OLD.checksum
      OR NEW.notes IS DISTINCT FROM OLD.notes
      OR NEW.is_immutable IS DISTINCT FROM OLD.is_immutable
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Locked budget baseline header cannot be changed';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (OLD.status = 'locked' AND NEW.status IN ('superseded', 'voided')) THEN
        RAISE EXCEPTION 'Budget baseline status transition is not allowed';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_budget_baseline_line_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO parent_status FROM public.budget_baselines WHERE id = OLD.budget_baseline_id AND organisation_id = OLD.organisation_id;
    IF OLD.is_immutable = true OR parent_status = 'locked' THEN
      RAISE EXCEPTION 'Locked budget baseline lines cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  SELECT status INTO parent_status FROM public.budget_baselines WHERE id = OLD.budget_baseline_id AND organisation_id = OLD.organisation_id;
  IF OLD.is_immutable = true OR parent_status = 'locked' THEN
    IF OLD.is_immutable = false
      AND NEW.is_immutable = true
      AND NEW.organisation_id IS NOT DISTINCT FROM OLD.organisation_id
      AND NEW.budget_baseline_id IS NOT DISTINCT FROM OLD.budget_baseline_id
      AND NEW.plan_id IS NOT DISTINCT FROM OLD.plan_id
      AND NEW.fiscal_year_id IS NOT DISTINCT FROM OLD.fiscal_year_id
      AND NEW.period_id IS NOT DISTINCT FROM OLD.period_id
      AND NEW.period_start IS NOT DISTINCT FROM OLD.period_start
      AND NEW.period_end IS NOT DISTINCT FROM OLD.period_end
      AND NEW.workload_hours IS NOT DISTINCT FROM OLD.workload_hours
      AND NEW.required_fte IS NOT DISTINCT FROM OLD.required_fte
      AND NEW.supply_gap_fte IS NOT DISTINCT FROM OLD.supply_gap_fte
      AND NEW.labour_cost IS NOT DISTINCT FROM OLD.labour_cost
      AND NEW.budget_amount IS NOT DISTINCT FROM OLD.budget_amount
      AND NEW.phasing_method IS NOT DISTINCT FROM OLD.phasing_method
      AND NEW.source_category IS NOT DISTINCT FROM OLD.source_category
      AND NEW.notes IS NOT DISTINCT FROM OLD.notes
      AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
      AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Locked budget baseline lines cannot be edited';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_budget_baseline_snapshot_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Budget baseline snapshots are immutable and cannot be updated or deleted';
END;
$$;

CREATE TRIGGER protect_budget_baseline_update
BEFORE UPDATE OR DELETE ON public.budget_baselines
FOR EACH ROW EXECUTE FUNCTION public.protect_budget_baseline_update();

CREATE TRIGGER protect_budget_baseline_line_update
BEFORE UPDATE OR DELETE ON public.budget_baseline_lines
FOR EACH ROW EXECUTE FUNCTION public.protect_budget_baseline_line_update();

CREATE TRIGGER protect_budget_baseline_snapshot_update
BEFORE UPDATE OR DELETE ON public.budget_baseline_snapshots
FOR EACH ROW EXECUTE FUNCTION public.protect_budget_baseline_snapshot_update();

-- Phase 4 refines the controlled handoff transition so a planner who is permitted to create a
-- draft budget baseline can mark a ready Layer 1 handoff as imported, but only through server-side RPC.
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
BEGIN
  IF NOT public.user_has_any_org_role(target_organisation_id, target_actor_user_id, ARRAY['owner', 'admin', 'finance_admin']) THEN
    RAISE EXCEPTION 'Insufficient permission to lock budget baseline';
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
      locked_at = now(),
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
    now(),
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
    'Immutable budget baseline snapshot created'
  );

  RETURN jsonb_build_object('baseline', to_jsonb(locked_baseline), 'snapshot', to_jsonb(new_snapshot));
END;
$$;

REVOKE ALL ON FUNCTION public.create_budget_baseline_draft(uuid, uuid, jsonb, jsonb, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.lock_budget_baseline(uuid, uuid, uuid, uuid, uuid, jsonb, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_budget_baseline_draft(uuid, uuid, jsonb, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_budget_baseline(uuid, uuid, uuid, uuid, uuid, jsonb, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.transition_layer1_handoff_status_controlled(uuid, uuid, uuid, uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_layer1_handoff_status_controlled(uuid, uuid, uuid, uuid, text, text) TO service_role;
