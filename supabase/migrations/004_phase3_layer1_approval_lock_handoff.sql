-- Workforce Planning and Labour Budget Governance Platform
-- Phase 3 Layer 1 approval, immutable version lock and handoff readiness
-- Scope: Layer 1 governance only. No Layer 2 baseline import, drivers, actuals, variance, waterfall or AI.

ALTER TABLE public.calculation_runs
  DROP CONSTRAINT IF EXISTS calculation_runs_run_status_check;

ALTER TABLE public.calculation_runs
  ADD CONSTRAINT calculation_runs_run_status_check
  CHECK (run_status IN ('draft', 'calculated', 'submitted_for_review', 'approved', 'locked', 'superseded'));

ALTER TABLE public.calculation_runs
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_notes text;

ALTER TABLE public.layer1_version_locks
  ADD COLUMN IF NOT EXISTS fiscal_year_id uuid,
  ADD COLUMN IF NOT EXISTS approved_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS approval_notes text;

ALTER TABLE public.layer1_handoff_objects
  DROP CONSTRAINT IF EXISTS layer1_handoff_objects_handoff_status_check;

ALTER TABLE public.layer1_handoff_objects
  ADD CONSTRAINT layer1_handoff_objects_handoff_status_check
  CHECK (handoff_status IN ('draft', 'approved', 'locked', 'ready_for_layer2', 'imported_to_baseline', 'superseded', 'voided'));

ALTER TABLE public.layer1_handoff_objects
  ADD COLUMN IF NOT EXISTS approved_calculation_run_id uuid,
  ADD COLUMN IF NOT EXISTS source_summary_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS risk_summary_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS annualisation_note text;

ALTER TABLE public.layer1_version_locks
  ADD CONSTRAINT layer1_version_locks_fiscal_year_same_org_fk
  FOREIGN KEY (organisation_id, fiscal_year_id) REFERENCES public.fiscal_years(organisation_id, id);

ALTER TABLE public.layer1_handoff_objects
  ADD CONSTRAINT layer1_handoff_objects_run_same_org_fk
  FOREIGN KEY (organisation_id, approved_calculation_run_id) REFERENCES public.calculation_runs(organisation_id, id);

CREATE INDEX IF NOT EXISTS idx_layer1_version_locks_org_plan ON public.layer1_version_locks(organisation_id, plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_layer1_handoff_objects_org_plan ON public.layer1_handoff_objects(organisation_id, plan_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.protect_calculation_run_governance_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.run_status IN ('submitted_for_review', 'approved', 'locked', 'superseded') THEN
      RAISE EXCEPTION 'Governed Layer 1 calculation runs cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.run_status IN ('submitted_for_review', 'approved', 'locked', 'superseded') THEN
    IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
      OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
      OR NEW.scenario_id IS DISTINCT FROM OLD.scenario_id
      OR NEW.run_type IS DISTINCT FROM OLD.run_type
      OR NEW.workload_hours IS DISTINCT FROM OLD.workload_hours
      OR NEW.measured_workload_hours IS DISTINCT FROM OLD.measured_workload_hours
      OR NEW.estimated_workload_hours IS DISTINCT FROM OLD.estimated_workload_hours
      OR NEW.hidden_workload_hours IS DISTINCT FROM OLD.hidden_workload_hours
      OR NEW.productive_hours_per_fte IS DISTINCT FROM OLD.productive_hours_per_fte
      OR NEW.required_fte IS DISTINCT FROM OLD.required_fte
      OR NEW.current_supply_fte IS DISTINCT FROM OLD.current_supply_fte
      OR NEW.supply_gap_fte IS DISTINCT FROM OLD.supply_gap_fte
      OR NEW.weighted_annual_cost_per_fte IS DISTINCT FROM OLD.weighted_annual_cost_per_fte
      OR NEW.annual_labour_cost IS DISTINCT FROM OLD.annual_labour_cost
      OR NEW.annual_budget_target IS DISTINCT FROM OLD.annual_budget_target
      OR NEW.variance_to_target IS DISTINCT FROM OLD.variance_to_target
      OR NEW.confidence_score IS DISTINCT FROM OLD.confidence_score
      OR NEW.source_quality_score IS DISTINCT FROM OLD.source_quality_score
      OR NEW.risk_flags_json IS DISTINCT FROM OLD.risk_flags_json
      OR NEW.calculation_output_json IS DISTINCT FROM OLD.calculation_output_json
      OR NEW.scenario_summary_json IS DISTINCT FROM OLD.scenario_summary_json
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Governed Layer 1 calculation payload cannot be changed';
    END IF;
  END IF;

  IF NEW.run_status IS DISTINCT FROM OLD.run_status THEN
    IF NOT (
      (OLD.run_status = 'calculated' AND NEW.run_status = 'submitted_for_review') OR
      (OLD.run_status = 'submitted_for_review' AND NEW.run_status = 'approved') OR
      (OLD.run_status = 'approved' AND NEW.run_status = 'locked') OR
      (OLD.run_status IN ('approved', 'locked') AND NEW.run_status = 'superseded')
    ) THEN
      RAISE EXCEPTION 'Layer 1 calculation run status transition is not allowed';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_calculation_run_governance_update ON public.calculation_runs;
CREATE TRIGGER protect_calculation_run_governance_update
BEFORE UPDATE OR DELETE ON public.calculation_runs
FOR EACH ROW EXECUTE FUNCTION public.protect_calculation_run_governance_update();

CREATE OR REPLACE FUNCTION public.protect_layer1_version_lock_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Layer 1 version locks cannot be deleted';
  END IF;

  IF OLD.is_immutable = true THEN
    IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
      OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
      OR NEW.fiscal_year_id IS DISTINCT FROM OLD.fiscal_year_id
      OR NEW.version_id IS DISTINCT FROM OLD.version_id
      OR NEW.approved_calculation_run_id IS DISTINCT FROM OLD.approved_calculation_run_id
      OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
      OR NEW.approval_notes IS DISTINCT FROM OLD.approval_notes
      OR NEW.approved_snapshot_json IS DISTINCT FROM OLD.approved_snapshot_json
      OR NEW.checksum IS DISTINCT FROM OLD.checksum
      OR NEW.is_immutable IS DISTINCT FROM OLD.is_immutable
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Locked calculation references and approved snapshot JSON cannot be changed';
    END IF;

    IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
      IF NOT (
        (OLD.approval_status = 'approved' AND NEW.approval_status = 'locked') OR
        (OLD.approval_status IN ('approved', 'locked') AND NEW.approval_status IN ('superseded', 'voided'))
      ) THEN
        RAISE EXCEPTION 'Layer 1 version lock status transition is not allowed';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_layer1_handoff_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Layer 1 handoff objects cannot be deleted';
  END IF;

  IF OLD.is_immutable = true THEN
    IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
      OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
      OR NEW.fiscal_year_id IS DISTINCT FROM OLD.fiscal_year_id
      OR NEW.version_lock_id IS DISTINCT FROM OLD.version_lock_id
      OR NEW.approved_calculation_run_id IS DISTINCT FROM OLD.approved_calculation_run_id
      OR NEW.source_quality_score IS DISTINCT FROM OLD.source_quality_score
      OR NEW.confidence_score IS DISTINCT FROM OLD.confidence_score
      OR NEW.assumption_risk_level IS DISTINCT FROM OLD.assumption_risk_level
      OR NEW.demand_inputs_json IS DISTINCT FROM OLD.demand_inputs_json
      OR NEW.hidden_work_inputs_json IS DISTINCT FROM OLD.hidden_work_inputs_json
      OR NEW.workload_outputs_json IS DISTINCT FROM OLD.workload_outputs_json
      OR NEW.required_fte_outputs_json IS DISTINCT FROM OLD.required_fte_outputs_json
      OR NEW.supply_gap_outputs_json IS DISTINCT FROM OLD.supply_gap_outputs_json
      OR NEW.labour_budget_outputs_json IS DISTINCT FROM OLD.labour_budget_outputs_json
      OR NEW.scenario_outputs_json IS DISTINCT FROM OLD.scenario_outputs_json
      OR NEW.key_assumptions_json IS DISTINCT FROM OLD.key_assumptions_json
      OR NEW.unresolved_risks_json IS DISTINCT FROM OLD.unresolved_risks_json
      OR NEW.source_summary_json IS DISTINCT FROM OLD.source_summary_json
      OR NEW.risk_summary_json IS DISTINCT FROM OLD.risk_summary_json
      OR NEW.annualisation_note IS DISTINCT FROM OLD.annualisation_note
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.is_immutable IS DISTINCT FROM OLD.is_immutable THEN
      RAISE EXCEPTION 'Approved handoff snapshot JSON cannot be changed';
    END IF;

    IF NEW.handoff_status IS DISTINCT FROM OLD.handoff_status THEN
      IF NOT (
        (OLD.handoff_status = 'draft' AND NEW.handoff_status IN ('approved', 'locked', 'ready_for_layer2')) OR
        (OLD.handoff_status = 'approved' AND NEW.handoff_status IN ('locked', 'ready_for_layer2', 'superseded', 'voided')) OR
        (OLD.handoff_status = 'locked' AND NEW.handoff_status IN ('ready_for_layer2', 'superseded', 'voided')) OR
        (OLD.handoff_status = 'ready_for_layer2' AND NEW.handoff_status IN ('imported_to_baseline', 'superseded', 'voided')) OR
        (OLD.handoff_status = 'imported_to_baseline' AND NEW.handoff_status = 'superseded')
      ) THEN
        RAISE EXCEPTION 'Layer 1 handoff status transition is not allowed';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_layer1_handoff_status(
  target_organisation_id uuid,
  target_handoff_id uuid,
  next_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_org_role(target_organisation_id, ARRAY['owner', 'admin', 'finance_admin']) THEN
    RAISE EXCEPTION 'Insufficient permission for Layer 1 handoff transition';
  END IF;

  UPDATE public.layer1_handoff_objects
  SET handoff_status = next_status
  WHERE id = target_handoff_id
    AND organisation_id = target_organisation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Layer 1 handoff object not found for organisation';
  END IF;
END;
$$;
