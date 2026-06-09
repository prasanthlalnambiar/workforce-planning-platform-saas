-- Workforce Planning and Labour Budget Governance Platform
-- Phase 1 SaaS foundation + Layer 1 scaffolding
-- Target: Supabase/PostgreSQL

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATED_AT TRIGGER
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TENANCY, PROFILES, MEMBERSHIP, ROLES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  industry text,
  country text,
  default_currency text NOT NULL DEFAULT 'AUD',
  fiscal_year_start_month int NOT NULL DEFAULT 7 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  timezone text NOT NULL DEFAULT 'Australia/Melbourne',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  default_organisation_id uuid REFERENCES public.organisations(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email)
);

CREATE TABLE public.organisation_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, user_id)
);

CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  role_name text NOT NULL CHECK (role_name IN (
    'owner', 'admin', 'finance_admin', 'planner', 'reviewer', 'viewer',
    'integration_admin', 'ai_admin', 'auditor'
  )),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, role_name)
);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, user_id, role_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- PLANS, FISCAL YEARS, MONTHLY PLANNING PERIODS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_name text NOT NULL,
  plan_description text,
  plan_type text NOT NULL DEFAULT 'workforce_budget_governance',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, plan_name)
);

CREATE TABLE public.fiscal_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.plans(id) ON DELETE CASCADE,
  fiscal_year_label text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  baseline_planning_start_date date,
  baseline_lock_deadline date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'locked', 'archived')),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, plan_id, fiscal_year_label)
);

CREATE TABLE public.planning_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  fiscal_year_id uuid NOT NULL REFERENCES public.fiscal_years(id) ON DELETE CASCADE,
  period_number int NOT NULL CHECK (period_number BETWEEN 1 AND 12),
  period_start date NOT NULL,
  period_end date NOT NULL,
  period_label text NOT NULL,
  status text NOT NULL DEFAULT 'future_unlocked' CHECK (status IN (
    'future_unlocked', 'current_open', 'actuals_pending', 'forecast_locked', 'closed'
  )),
  editable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, fiscal_year_id, period_number)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- SHARED DIMENSIONS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, name)
);

CREATE TABLE public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  region_id uuid REFERENCES public.regions(id),
  name text NOT NULL,
  country text,
  cost_zone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, name)
);

CREATE TABLE public.channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, name)
);

CREATE TABLE public.work_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.plans(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'measured' CHECK (category IN ('measured', 'estimated', 'hidden')),
  model_type text NOT NULL DEFAULT 'workload' CHECK (model_type IN ('workload', 'contact', 'case', 'knowledge', 'support')),
  team_or_function text,
  channel_id uuid REFERENCES public.channels(id),
  role_group text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, plan_id, name)
);

CREATE TABLE public.workforce_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  employment_type text NOT NULL DEFAULT 'internal' CHECK (employment_type IN ('internal', 'vendor', 'hybrid', 'contractor', 'other')),
  vendor_name text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, name)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- LAYER 1 SCAFFOLDING: DEMAND TO FTE AND BUDGET ENGINE
-- These are tables only in Phase 1. Calculation services are Phase 2.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.planning_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  decision_owner text,
  planning_horizon text,
  service_target text,
  budget_target numeric(18,2),
  scope_boundary text,
  success_criteria text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'approved', 'archived')),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.source_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  source_name text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN (
    'wfm', 'crm', 'case_system', 'finance_plan', 'sales_forecast', 'stakeholder_interview',
    'manual_tracker', 'calendar_sample', 'benchmark', 'unknown', 'other'
  )),
  owner text,
  recency text,
  completeness_score numeric(5,2) CHECK (completeness_score IS NULL OR completeness_score BETWEEN 0 AND 100),
  source_quality_score numeric(5,2) CHECK (source_quality_score IS NULL OR source_quality_score BETWEEN 0 AND 100),
  missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  duplicate_risk text CHECK (duplicate_risk IS NULL OR duplicate_risk IN ('low', 'medium', 'high')),
  approval_status text NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft', 'proposed', 'approved', 'rejected')),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.demand_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  period_id uuid REFERENCES public.planning_periods(id) ON DELETE CASCADE,
  work_type_id uuid REFERENCES public.work_types(id),
  demand_volume numeric(18,2),
  processing_minutes numeric(12,4),
  hidden_work_hours numeric(18,2),
  source_id uuid REFERENCES public.source_inventory(id),
  source_quality_score numeric(5,2) CHECK (source_quality_score IS NULL OR source_quality_score BETWEEN 0 AND 100),
  confidence_score numeric(5,2) CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100),
  assumption_reference text,
  rationale text,
  owner text,
  risk_level text CHECK (risk_level IS NULL OR risk_level IN ('low', 'medium', 'high', 'critical')),
  approval_status text NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft', 'proposed', 'approved', 'rejected')),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.capacity_assumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  period_id uuid REFERENCES public.planning_periods(id) ON DELETE CASCADE,
  working_days numeric(8,2),
  hours_per_day numeric(8,2),
  utilisation numeric(8,4) CHECK (utilisation IS NULL OR utilisation BETWEEN 0 AND 1),
  shrinkage numeric(8,4) CHECK (shrinkage IS NULL OR shrinkage >= 0 AND shrinkage < 1),
  coverage_factor numeric(8,4),
  ramp_factor numeric(8,4),
  source text,
  confidence_score numeric(5,2) CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100),
  approval_status text NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft', 'proposed', 'approved', 'rejected')),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cost_assumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  location_or_vendor text NOT NULL,
  share numeric(8,4) CHECK (share IS NULL OR share BETWEEN 0 AND 1),
  annual_loaded_cost_per_fte numeric(18,2),
  source text,
  confidence_score numeric(5,2) CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100),
  approval_status text NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft', 'proposed', 'approved', 'rejected')),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.scenario_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  scenario_name text NOT NULL,
  scenario_type text NOT NULL DEFAULT 'base' CHECK (scenario_type IN (
    'base', 'high_demand', 'productivity', 'ai_efficiency', 'finance_constrained', 'custom'
  )),
  volume_multiplier numeric(12,4) NOT NULL DEFAULT 1,
  processing_multiplier numeric(12,4) NOT NULL DEFAULT 1,
  hidden_work_multiplier numeric(12,4) NOT NULL DEFAULT 1,
  utilisation_delta numeric(8,4) NOT NULL DEFAULT 0,
  shrinkage_delta numeric(8,4) NOT NULL DEFAULT 0,
  budget_multiplier numeric(12,4) NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'proposed', 'approved', 'archived')),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, plan_id, scenario_name)
);

CREATE TABLE public.calculation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  scenario_id uuid REFERENCES public.scenario_definitions(id),
  run_type text NOT NULL DEFAULT 'layer1_demand_to_budget',
  workload_hours numeric(18,2),
  productive_hours_per_fte numeric(18,4),
  required_fte numeric(12,2),
  current_supply_fte numeric(12,2),
  supply_gap_fte numeric(12,2),
  weighted_annual_cost_per_fte numeric(18,2),
  annual_labour_cost numeric(18,2),
  annual_budget_target numeric(18,2),
  variance_to_target numeric(18,2),
  confidence_score numeric(5,2),
  source_quality_score numeric(5,2),
  run_status text NOT NULL DEFAULT 'draft' CHECK (run_status IN ('draft', 'calculated', 'approved', 'locked', 'superseded')),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.layer1_version_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  version_id text NOT NULL,
  approved_calculation_run_id uuid NOT NULL REFERENCES public.calculation_runs(id),
  approval_status text NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('approved', 'locked', 'superseded', 'voided')),
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  locked_by uuid REFERENCES public.profiles(id),
  locked_at timestamptz,
  checksum text NOT NULL,
  change_reason text,
  audit_event_id uuid,
  is_immutable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, plan_id, version_id)
);

CREATE TABLE public.layer1_handoff_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  fiscal_year_id uuid REFERENCES public.fiscal_years(id),
  version_lock_id uuid NOT NULL REFERENCES public.layer1_version_locks(id),
  handoff_status text NOT NULL DEFAULT 'ready_for_layer2' CHECK (handoff_status IN (
    'draft', 'ready_for_layer2', 'imported_to_baseline', 'superseded', 'voided'
  )),
  source_quality_score numeric(5,2),
  confidence_score numeric(5,2),
  assumption_risk_level text CHECK (assumption_risk_level IS NULL OR assumption_risk_level IN ('low', 'medium', 'high', 'critical')),
  demand_inputs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  hidden_work_inputs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  workload_outputs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_fte_outputs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  supply_gap_outputs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  labour_budget_outputs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  scenario_outputs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  key_assumptions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  unresolved_risks_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  is_immutable boolean NOT NULL DEFAULT true
);

-- ─────────────────────────────────────────────────────────────────────────────
-- AUDIT EVENTS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.profiles(id),
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  plan_id uuid REFERENCES public.plans(id),
  fiscal_year_id uuid REFERENCES public.fiscal_years(id),
  planning_period_id uuid REFERENCES public.planning_periods(id),
  old_value_json jsonb,
  new_value_json jsonb,
  reason text,
  ip_address inet,
  user_agent text,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.layer1_version_locks
  ADD CONSTRAINT layer1_version_locks_audit_fk
  FOREIGN KEY (audit_event_id) REFERENCES public.audit_events(id);

-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATED_AT TRIGGERS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TRIGGER organisations_set_updated_at BEFORE UPDATE ON public.organisations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER memberships_set_updated_at BEFORE UPDATE ON public.organisation_memberships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER plans_set_updated_at BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER fiscal_years_set_updated_at BEFORE UPDATE ON public.fiscal_years FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER planning_periods_set_updated_at BEFORE UPDATE ON public.planning_periods FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER regions_set_updated_at BEFORE UPDATE ON public.regions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER locations_set_updated_at BEFORE UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER channels_set_updated_at BEFORE UPDATE ON public.channels FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER work_types_set_updated_at BEFORE UPDATE ON public.work_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER workforce_groups_set_updated_at BEFORE UPDATE ON public.workforce_groups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER planning_briefs_set_updated_at BEFORE UPDATE ON public.planning_briefs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER source_inventory_set_updated_at BEFORE UPDATE ON public.source_inventory FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER demand_inputs_set_updated_at BEFORE UPDATE ON public.demand_inputs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER capacity_assumptions_set_updated_at BEFORE UPDATE ON public.capacity_assumptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER cost_assumptions_set_updated_at BEFORE UPDATE ON public.cost_assumptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER scenario_definitions_set_updated_at BEFORE UPDATE ON public.scenario_definitions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- IMMUTABILITY GUARDS FOR LOCKED LAYER 1 OUTPUTS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.prevent_immutable_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_immutable = true THEN
    RAISE EXCEPTION 'Immutable record cannot be updated or deleted';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_layer1_version_lock_update
BEFORE UPDATE OR DELETE ON public.layer1_version_locks
FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_update();

CREATE TRIGGER prevent_layer1_handoff_update
BEFORE UPDATE OR DELETE ON public.layer1_handoff_objects
FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_update();

-- ─────────────────────────────────────────────────────────────────────────────
-- AUTH PROFILE TRIGGER
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS HELPER FUNCTIONS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_org_member(target_organisation_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organisation_memberships m
    WHERE m.organisation_id = target_organisation_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(target_organisation_id uuid, allowed_roles text[])
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organisation_memberships m
    JOIN public.user_roles ur
      ON ur.organisation_id = m.organisation_id
     AND ur.user_id = m.user_id
    JOIN public.roles r
      ON r.id = ur.role_id
    WHERE m.organisation_id = target_organisation_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
      AND r.role_name = ANY(allowed_roles)
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ENABLE RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planning_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planning_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demand_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capacity_assumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_assumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenario_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calculation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.layer1_version_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.layer1_handoff_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS POLICIES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY organisations_select_member ON public.organisations
  FOR SELECT USING (public.is_org_member(id));

CREATE POLICY organisations_insert_authenticated ON public.organisations
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY organisations_update_admin ON public.organisations
  FOR UPDATE USING (public.has_org_role(id, ARRAY['owner', 'admin']))
  WITH CHECK (public.has_org_role(id, ARRAY['owner', 'admin']));

CREATE POLICY profiles_select_self ON public.profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY memberships_select_member ON public.organisation_memberships
  FOR SELECT USING (public.is_org_member(organisation_id));

CREATE POLICY memberships_admin_write ON public.organisation_memberships
  FOR ALL USING (public.has_org_role(organisation_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.has_org_role(organisation_id, ARRAY['owner', 'admin']));

CREATE POLICY roles_select_member ON public.roles
  FOR SELECT USING (public.is_org_member(organisation_id));

CREATE POLICY roles_admin_write ON public.roles
  FOR ALL USING (public.has_org_role(organisation_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.has_org_role(organisation_id, ARRAY['owner', 'admin']));

CREATE POLICY user_roles_select_member ON public.user_roles
  FOR SELECT USING (public.is_org_member(organisation_id));

CREATE POLICY user_roles_admin_write ON public.user_roles
  FOR ALL USING (public.has_org_role(organisation_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.has_org_role(organisation_id, ARRAY['owner', 'admin']));

CREATE POLICY plans_select_member ON public.plans
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY plans_planner_write ON public.plans
  FOR ALL USING (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']))
  WITH CHECK (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']));

CREATE POLICY fiscal_years_select_member ON public.fiscal_years
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY fiscal_years_planner_finance_write ON public.fiscal_years
  FOR ALL USING (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner', 'finance_admin']))
  WITH CHECK (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner', 'finance_admin']));

CREATE POLICY planning_periods_select_member ON public.planning_periods
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY planning_periods_planner_finance_write ON public.planning_periods
  FOR ALL USING (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner', 'finance_admin']))
  WITH CHECK (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner', 'finance_admin']));

CREATE POLICY regions_select_member ON public.regions
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY regions_planner_write ON public.regions
  FOR ALL USING (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']))
  WITH CHECK (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']));

CREATE POLICY locations_select_member ON public.locations
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY locations_planner_write ON public.locations
  FOR ALL USING (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']))
  WITH CHECK (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']));

CREATE POLICY channels_select_member ON public.channels
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY channels_planner_write ON public.channels
  FOR ALL USING (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']))
  WITH CHECK (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']));

CREATE POLICY work_types_select_member ON public.work_types
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY work_types_planner_write ON public.work_types
  FOR ALL USING (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']))
  WITH CHECK (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']));

CREATE POLICY workforce_groups_select_member ON public.workforce_groups
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY workforce_groups_planner_write ON public.workforce_groups
  FOR ALL USING (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']))
  WITH CHECK (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']));

CREATE POLICY planning_briefs_select_member ON public.planning_briefs
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY planning_briefs_planner_write ON public.planning_briefs
  FOR ALL USING (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']))
  WITH CHECK (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']));

CREATE POLICY source_inventory_select_member ON public.source_inventory
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY source_inventory_planner_write ON public.source_inventory
  FOR ALL USING (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']))
  WITH CHECK (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']));

CREATE POLICY demand_inputs_select_member ON public.demand_inputs
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY demand_inputs_planner_write ON public.demand_inputs
  FOR ALL USING (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']))
  WITH CHECK (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']));

CREATE POLICY capacity_assumptions_select_member ON public.capacity_assumptions
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY capacity_assumptions_planner_write ON public.capacity_assumptions
  FOR ALL USING (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']))
  WITH CHECK (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']));

CREATE POLICY cost_assumptions_select_member ON public.cost_assumptions
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY cost_assumptions_planner_finance_write ON public.cost_assumptions
  FOR ALL USING (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner', 'finance_admin']))
  WITH CHECK (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner', 'finance_admin']));

CREATE POLICY scenario_definitions_select_member ON public.scenario_definitions
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY scenario_definitions_planner_write ON public.scenario_definitions
  FOR ALL USING (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']))
  WITH CHECK (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']));

CREATE POLICY calculation_runs_select_member ON public.calculation_runs
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY calculation_runs_planner_insert ON public.calculation_runs
  FOR INSERT WITH CHECK (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'planner']));

CREATE POLICY layer1_version_locks_select_member ON public.layer1_version_locks
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY layer1_version_locks_finance_insert ON public.layer1_version_locks
  FOR INSERT WITH CHECK (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'finance_admin']));

CREATE POLICY layer1_handoff_objects_select_member ON public.layer1_handoff_objects
  FOR SELECT USING (public.is_org_member(organisation_id));
CREATE POLICY layer1_handoff_objects_finance_insert ON public.layer1_handoff_objects
  FOR INSERT WITH CHECK (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'finance_admin']));

CREATE POLICY audit_events_select_auditor ON public.audit_events
  FOR SELECT USING (public.has_org_role(organisation_id, ARRAY['owner', 'admin', 'auditor']));

CREATE POLICY audit_events_insert_member ON public.audit_events
  FOR INSERT WITH CHECK (public.is_org_member(organisation_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX idx_profiles_default_org ON public.profiles(default_organisation_id);
CREATE INDEX idx_memberships_org_user ON public.organisation_memberships(organisation_id, user_id);
CREATE INDEX idx_user_roles_org_user ON public.user_roles(organisation_id, user_id);
CREATE INDEX idx_plans_org ON public.plans(organisation_id);
CREATE INDEX idx_fiscal_years_org_plan ON public.fiscal_years(organisation_id, plan_id);
CREATE INDEX idx_periods_org_fy ON public.planning_periods(organisation_id, fiscal_year_id);
CREATE INDEX idx_demand_inputs_org_plan ON public.demand_inputs(organisation_id, plan_id);
CREATE INDEX idx_calculation_runs_org_plan ON public.calculation_runs(organisation_id, plan_id);
CREATE INDEX idx_audit_events_org_created ON public.audit_events(organisation_id, created_at DESC);
