-- Workforce Planning and Labour Budget Governance Platform
-- Phase 1.1 foundation hardening
-- Scope: audit integrity, Layer 1 immutability refinement, onboarding-safe org creation,
-- and tenant-consistency guardrails. No Phase 2 calculation logic is introduced here.

-- ─────────────────────────────────────────────────────────────────────────────
-- AUDIT EVENT INTEGRITY
-- Direct browser/client inserts are deliberately removed. Audit writes are performed
-- by controlled server-side application code using a server-only credential.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS audit_events_insert_member ON public.audit_events;
REVOKE INSERT, UPDATE, DELETE ON public.audit_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only and cannot be updated or deleted';
END;
$$;

DROP TRIGGER IF EXISTS prevent_audit_event_update_delete ON public.audit_events;
CREATE TRIGGER prevent_audit_event_update_delete
BEFORE UPDATE OR DELETE ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_event_mutation();

-- Organisation bootstrap is controlled by server-side onboarding. Remove casual
-- authenticated organisation creation through the browser client.
DROP POLICY IF EXISTS organisations_insert_authenticated ON public.organisations;
REVOKE INSERT ON public.organisations FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- TENANT CONSISTENCY GUARDRAILS
-- Composite organisation-aware foreign keys prevent a record in one organisation
-- from pointing at a plan, period, dimension or lock from another organisation.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.roles ADD CONSTRAINT roles_org_id_unique UNIQUE (organisation_id, id);
ALTER TABLE public.plans ADD CONSTRAINT plans_org_id_unique UNIQUE (organisation_id, id);
ALTER TABLE public.fiscal_years ADD CONSTRAINT fiscal_years_org_id_unique UNIQUE (organisation_id, id);
ALTER TABLE public.planning_periods ADD CONSTRAINT planning_periods_org_id_unique UNIQUE (organisation_id, id);
ALTER TABLE public.regions ADD CONSTRAINT regions_org_id_unique UNIQUE (organisation_id, id);
ALTER TABLE public.channels ADD CONSTRAINT channels_org_id_unique UNIQUE (organisation_id, id);
ALTER TABLE public.work_types ADD CONSTRAINT work_types_org_id_unique UNIQUE (organisation_id, id);
ALTER TABLE public.source_inventory ADD CONSTRAINT source_inventory_org_id_unique UNIQUE (organisation_id, id);
ALTER TABLE public.scenario_definitions ADD CONSTRAINT scenario_definitions_org_id_unique UNIQUE (organisation_id, id);
ALTER TABLE public.calculation_runs ADD CONSTRAINT calculation_runs_org_id_unique UNIQUE (organisation_id, id);
ALTER TABLE public.layer1_version_locks ADD CONSTRAINT layer1_version_locks_org_id_unique UNIQUE (organisation_id, id);

ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_role_same_org_fk
  FOREIGN KEY (organisation_id, role_id) REFERENCES public.roles(organisation_id, id) ON DELETE CASCADE;

ALTER TABLE public.fiscal_years
  ADD CONSTRAINT fiscal_years_plan_same_org_fk
  FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE;

ALTER TABLE public.planning_periods
  ADD CONSTRAINT planning_periods_fiscal_year_same_org_fk
  FOREIGN KEY (organisation_id, fiscal_year_id) REFERENCES public.fiscal_years(organisation_id, id) ON DELETE CASCADE;

ALTER TABLE public.locations
  ADD CONSTRAINT locations_region_same_org_fk
  FOREIGN KEY (organisation_id, region_id) REFERENCES public.regions(organisation_id, id);

ALTER TABLE public.work_types
  ADD CONSTRAINT work_types_plan_same_org_fk
  FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT work_types_channel_same_org_fk
  FOREIGN KEY (organisation_id, channel_id) REFERENCES public.channels(organisation_id, id);

ALTER TABLE public.planning_briefs
  ADD CONSTRAINT planning_briefs_plan_same_org_fk
  FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE;

ALTER TABLE public.source_inventory
  ADD CONSTRAINT source_inventory_plan_same_org_fk
  FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE;

ALTER TABLE public.demand_inputs
  ADD CONSTRAINT demand_inputs_plan_same_org_fk
  FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT demand_inputs_period_same_org_fk
  FOREIGN KEY (organisation_id, period_id) REFERENCES public.planning_periods(organisation_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT demand_inputs_work_type_same_org_fk
  FOREIGN KEY (organisation_id, work_type_id) REFERENCES public.work_types(organisation_id, id),
  ADD CONSTRAINT demand_inputs_source_same_org_fk
  FOREIGN KEY (organisation_id, source_id) REFERENCES public.source_inventory(organisation_id, id);

ALTER TABLE public.capacity_assumptions
  ADD CONSTRAINT capacity_assumptions_plan_same_org_fk
  FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT capacity_assumptions_period_same_org_fk
  FOREIGN KEY (organisation_id, period_id) REFERENCES public.planning_periods(organisation_id, id) ON DELETE CASCADE;

ALTER TABLE public.cost_assumptions
  ADD CONSTRAINT cost_assumptions_plan_same_org_fk
  FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE;

ALTER TABLE public.scenario_definitions
  ADD CONSTRAINT scenario_definitions_plan_same_org_fk
  FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE;

ALTER TABLE public.calculation_runs
  ADD CONSTRAINT calculation_runs_plan_same_org_fk
  FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT calculation_runs_scenario_same_org_fk
  FOREIGN KEY (organisation_id, scenario_id) REFERENCES public.scenario_definitions(organisation_id, id);

ALTER TABLE public.layer1_version_locks
  ADD CONSTRAINT layer1_version_locks_plan_same_org_fk
  FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT layer1_version_locks_run_same_org_fk
  FOREIGN KEY (organisation_id, approved_calculation_run_id) REFERENCES public.calculation_runs(organisation_id, id);

ALTER TABLE public.layer1_handoff_objects
  ADD CONSTRAINT layer1_handoff_objects_plan_same_org_fk
  FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT layer1_handoff_objects_fiscal_year_same_org_fk
  FOREIGN KEY (organisation_id, fiscal_year_id) REFERENCES public.fiscal_years(organisation_id, id),
  ADD CONSTRAINT layer1_handoff_objects_version_lock_same_org_fk
  FOREIGN KEY (organisation_id, version_lock_id) REFERENCES public.layer1_version_locks(organisation_id, id);

ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_plan_same_org_fk
  FOREIGN KEY (organisation_id, plan_id) REFERENCES public.plans(organisation_id, id),
  ADD CONSTRAINT audit_events_fiscal_year_same_org_fk
  FOREIGN KEY (organisation_id, fiscal_year_id) REFERENCES public.fiscal_years(organisation_id, id),
  ADD CONSTRAINT audit_events_period_same_org_fk
  FOREIGN KEY (organisation_id, planning_period_id) REFERENCES public.planning_periods(organisation_id, id);

-- ─────────────────────────────────────────────────────────────────────────────
-- LAYER 1 IMMUTABILITY REFINEMENT
-- Locked payloads and approved snapshots stay immutable, while controlled status
-- transitions remain possible through database functions for later phases.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS prevent_layer1_version_lock_update ON public.layer1_version_locks;
DROP TRIGGER IF EXISTS prevent_layer1_handoff_update ON public.layer1_handoff_objects;
DROP FUNCTION IF EXISTS public.prevent_immutable_update();

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
      OR NEW.version_id IS DISTINCT FROM OLD.version_id
      OR NEW.approved_calculation_run_id IS DISTINCT FROM OLD.approved_calculation_run_id
      OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
      OR NEW.checksum IS DISTINCT FROM OLD.checksum
      OR NEW.is_immutable IS DISTINCT FROM OLD.is_immutable
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Locked calculation references cannot be changed';
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
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.is_immutable IS DISTINCT FROM OLD.is_immutable THEN
      RAISE EXCEPTION 'Approved handoff snapshot JSON cannot be changed';
    END IF;

    IF NEW.handoff_status IS DISTINCT FROM OLD.handoff_status THEN
      IF NOT (
        (OLD.handoff_status = 'draft' AND NEW.handoff_status = 'ready_for_layer2') OR
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

CREATE TRIGGER protect_layer1_version_lock_update
BEFORE UPDATE OR DELETE ON public.layer1_version_locks
FOR EACH ROW EXECUTE FUNCTION public.protect_layer1_version_lock_update();

CREATE TRIGGER protect_layer1_handoff_update
BEFORE UPDATE OR DELETE ON public.layer1_handoff_objects
FOR EACH ROW EXECUTE FUNCTION public.protect_layer1_handoff_update();

CREATE OR REPLACE FUNCTION public.transition_layer1_version_lock_status(
  target_organisation_id uuid,
  target_version_lock_id uuid,
  next_status text,
  transition_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_org_role(target_organisation_id, ARRAY['owner', 'admin', 'finance_admin']) THEN
    RAISE EXCEPTION 'Insufficient permission for Layer 1 lock transition';
  END IF;

  UPDATE public.layer1_version_locks
  SET approval_status = next_status,
      locked_by = CASE WHEN next_status = 'locked' THEN auth.uid() ELSE locked_by END,
      locked_at = CASE WHEN next_status = 'locked' THEN now() ELSE locked_at END,
      change_reason = transition_reason
  WHERE id = target_version_lock_id
    AND organisation_id = target_organisation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Layer 1 version lock not found for organisation';
  END IF;
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

GRANT EXECUTE ON FUNCTION public.transition_layer1_version_lock_status(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_layer1_handoff_status(uuid, uuid, text) TO authenticated;
