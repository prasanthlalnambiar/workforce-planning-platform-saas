-- Workforce Planning and Labour Budget Governance Platform
-- Phase 5 Driver Layer
-- Scope: driver register, driver phasing, driver status governance and deterministic
-- driver impact inputs only. Drivers explain movement from the locked budget baseline.
-- No reforecast locks, actuals ingestion, variance analysis, waterfall reporting or AI.

CREATE TABLE public.forecast_drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  budget_baseline_id uuid NOT NULL,
  driver_code text NOT NULL,
  driver_name text NOT NULL,
  category text NOT NULL CHECK (category IN ('growth', 'efficiency', 'cost_change', 'supply_change', 'management_adjustment')),
  impact_type text NOT NULL CHECK (impact_type IN ('fte_delta', 'cost_delta', 'workload_hours_delta')),
  annual_impact_amount numeric(18,2) NOT NULL,
  phasing_model text NOT NULL CHECK (phasing_model IN ('straight_line', 'ramp_up', 'ramp_down', 'one_off')),
  start_period_id uuid NOT NULL,
  end_period_id uuid NOT NULL,
  one_off_period_id uuid,
  owner_user_id uuid REFERENCES public.profiles(id),
  confidence_rating text NOT NULL DEFAULT 'medium' CHECK (confidence_rating IN ('low', 'medium', 'high')),
  commentary text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'proposed', 'approved', 'superseded', 'voided')),
  supersedes_driver_id uuid,
  superseded_by_driver_id uuid,
  proposed_by uuid REFERENCES public.profiles(id),
  proposed_at timestamptz,
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  is_immutable boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, plan_id, fiscal_year_id, driver_code),
  CONSTRAINT forecast_drivers_plan_same_org_fk FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT forecast_drivers_fiscal_year_same_org_fk FOREIGN KEY (organisation_id, fiscal_year_id) REFERENCES public.fiscal_years(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT forecast_drivers_baseline_same_org_fk FOREIGN KEY (organisation_id, budget_baseline_id) REFERENCES public.budget_baselines(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT forecast_drivers_start_period_same_org_fk FOREIGN KEY (organisation_id, start_period_id) REFERENCES public.planning_periods(organisation_id, id),
  CONSTRAINT forecast_drivers_end_period_same_org_fk FOREIGN KEY (organisation_id, end_period_id) REFERENCES public.planning_periods(organisation_id, id),
  CONSTRAINT forecast_drivers_one_off_period_same_org_fk FOREIGN KEY (organisation_id, one_off_period_id) REFERENCES public.planning_periods(organisation_id, id),
  CONSTRAINT forecast_drivers_supersedes_same_org_fk FOREIGN KEY (organisation_id, supersedes_driver_id) REFERENCES public.forecast_drivers(organisation_id, id),
  CONSTRAINT forecast_drivers_superseded_by_same_org_fk FOREIGN KEY (organisation_id, superseded_by_driver_id) REFERENCES public.forecast_drivers(organisation_id, id),
  CONSTRAINT forecast_drivers_one_off_requires_period CHECK (phasing_model <> 'one_off' OR one_off_period_id IS NOT NULL)
);

CREATE TABLE public.forecast_driver_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  forecast_driver_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL,
  period_id uuid NOT NULL,
  period_number integer NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  impact_amount numeric(18,2) NOT NULL DEFAULT 0,
  is_immutable boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, forecast_driver_id, period_id),
  CONSTRAINT forecast_driver_lines_driver_same_org_fk FOREIGN KEY (organisation_id, forecast_driver_id) REFERENCES public.forecast_drivers(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT forecast_driver_lines_plan_same_org_fk FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT forecast_driver_lines_fiscal_year_same_org_fk FOREIGN KEY (organisation_id, fiscal_year_id) REFERENCES public.fiscal_years(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT forecast_driver_lines_period_same_org_fk FOREIGN KEY (organisation_id, period_id) REFERENCES public.planning_periods(organisation_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_forecast_drivers_org_plan_fy ON public.forecast_drivers(organisation_id, plan_id, fiscal_year_id, created_at DESC);
CREATE INDEX idx_forecast_drivers_baseline_status ON public.forecast_drivers(organisation_id, budget_baseline_id, status);
CREATE INDEX idx_forecast_driver_lines_driver ON public.forecast_driver_lines(organisation_id, forecast_driver_id, period_number);

CREATE TRIGGER forecast_drivers_set_updated_at BEFORE UPDATE ON public.forecast_drivers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER forecast_driver_lines_set_updated_at BEFORE UPDATE ON public.forecast_driver_lines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.forecast_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forecast_driver_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY forecast_drivers_select_member ON public.forecast_drivers
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY forecast_driver_lines_select_member ON public.forecast_driver_lines
  FOR SELECT USING (public.is_org_member(organisation_id));

-- All driver writes are routed through controlled SECURITY DEFINER RPCs executed by the
-- server-side service role only, so role checks, immutability and audit cannot be bypassed.
REVOKE INSERT, UPDATE, DELETE ON public.forecast_drivers FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.forecast_driver_lines FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Immutability protection
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_forecast_driver_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_immutable = true OR OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Only draft forecast drivers can be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IN ('superseded', 'voided') THEN
    RAISE EXCEPTION 'Forecast driver is in a terminal state and cannot be changed';
  END IF;

  IF OLD.status = 'approved' OR OLD.is_immutable = true THEN
    -- The only permitted change to an approved driver is the controlled supersede
    -- transition, which changes nothing except status and the supersede linkage.
    IF NEW.status = 'superseded'
      AND NEW.superseded_by_driver_id IS NOT NULL
      AND NEW.driver_name IS NOT DISTINCT FROM OLD.driver_name
      AND NEW.category IS NOT DISTINCT FROM OLD.category
      AND NEW.impact_type IS NOT DISTINCT FROM OLD.impact_type
      AND NEW.annual_impact_amount IS NOT DISTINCT FROM OLD.annual_impact_amount
      AND NEW.phasing_model IS NOT DISTINCT FROM OLD.phasing_model
      AND NEW.start_period_id IS NOT DISTINCT FROM OLD.start_period_id
      AND NEW.end_period_id IS NOT DISTINCT FROM OLD.end_period_id
      AND NEW.one_off_period_id IS NOT DISTINCT FROM OLD.one_off_period_id
      AND NEW.budget_baseline_id IS NOT DISTINCT FROM OLD.budget_baseline_id
      AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by
      AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Approved forecast drivers are immutable. Use the controlled supersede workflow.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_forecast_driver_line_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status
  FROM public.forecast_drivers
  WHERE organisation_id = OLD.organisation_id AND id = OLD.forecast_driver_id;

  IF TG_OP = 'DELETE' THEN
    IF OLD.is_immutable = true OR COALESCE(parent_status, 'draft') NOT IN ('draft', 'proposed') THEN
      RAISE EXCEPTION 'Phased lines of governed forecast drivers cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_immutable = true THEN
    RAISE EXCEPTION 'Forecast driver lines are immutable once the driver is approved';
  END IF;

  IF COALESCE(parent_status, 'draft') NOT IN ('draft', 'proposed') THEN
    -- Permit the approval flip only: is_immutable false -> true with no value changes.
    IF NEW.is_immutable = true
      AND NEW.impact_amount IS NOT DISTINCT FROM OLD.impact_amount
      AND NEW.period_id IS NOT DISTINCT FROM OLD.period_id
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Forecast driver lines cannot change after governance transitions';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_forecast_driver_update
BEFORE UPDATE OR DELETE ON public.forecast_drivers
FOR EACH ROW EXECUTE FUNCTION public.protect_forecast_driver_update();

CREATE TRIGGER protect_forecast_driver_line_update
BEFORE UPDATE OR DELETE ON public.forecast_driver_lines
FOR EACH ROW EXECUTE FUNCTION public.protect_forecast_driver_line_update();

-- ---------------------------------------------------------------------------
-- Shared validation used by the driver RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_forecast_driver_lines_reconcile(
  target_annual_amount numeric,
  line_payloads jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  line_total numeric := 0;
  line_item jsonb;
BEGIN
  IF line_payloads IS NULL OR jsonb_typeof(line_payloads) <> 'array' OR jsonb_array_length(line_payloads) = 0 THEN
    RAISE EXCEPTION 'Forecast driver phasing lines are required';
  END IF;

  FOR line_item IN SELECT * FROM jsonb_array_elements(line_payloads)
  LOOP
    line_total := line_total + COALESCE((line_item->>'impact_amount')::numeric, 0);
  END LOOP;

  IF abs(round(line_total, 2) - round(target_annual_amount, 2)) > 0.01 THEN
    RAISE EXCEPTION 'Forecast driver phasing does not reconcile to the annual impact amount (lines %, annual %)', round(line_total, 2), round(target_annual_amount, 2);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_forecast_driver_lines(
  target_organisation_id uuid,
  target_driver record,
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
    INSERT INTO public.forecast_driver_lines (
      organisation_id, forecast_driver_id, plan_id, fiscal_year_id,
      period_id, period_number, period_start, period_end, impact_amount, created_by
    ) VALUES (
      target_organisation_id,
      target_driver.id,
      target_driver.plan_id,
      target_driver.fiscal_year_id,
      (line_item->>'period_id')::uuid,
      COALESCE((line_item->>'period_number')::integer, 0),
      (line_item->>'period_start')::date,
      (line_item->>'period_end')::date,
      COALESCE((line_item->>'impact_amount')::numeric, 0),
      target_driver.created_by
    );
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: create a draft forecast driver against a locked budget baseline
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- RPC: update an editable (draft or proposed) forecast driver
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- RPC: governed driver status transitions
-- draft -> proposed, proposed -> draft, proposed -> approved, draft/proposed -> voided
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- RPC: controlled supersede of an approved driver
-- Creates a replacement draft and marks the approved driver superseded atomically.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Lock down the governance surface to the server-side service role only
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.create_forecast_driver(uuid, uuid, jsonb, jsonb, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.update_forecast_driver_draft(uuid, uuid, uuid, jsonb, jsonb, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_forecast_driver_status(uuid, uuid, uuid, text, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.supersede_forecast_driver(uuid, uuid, uuid, jsonb, jsonb, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_forecast_driver_lines_reconcile(numeric, jsonb) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.insert_forecast_driver_lines(uuid, record, jsonb) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_forecast_driver(uuid, uuid, jsonb, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_forecast_driver_draft(uuid, uuid, uuid, jsonb, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_forecast_driver_status(uuid, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.supersede_forecast_driver(uuid, uuid, uuid, jsonb, jsonb, text) TO service_role;
