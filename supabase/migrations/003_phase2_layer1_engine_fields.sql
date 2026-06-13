-- Workforce Planning and Labour Budget Governance Platform
-- Phase 2 Layer 1 deterministic demand-to-budget engine fields
-- Scope: only Layer 1 engine support fields. No approval locks, Layer 2, actuals, variance, waterfall or AI.

ALTER TABLE public.demand_inputs
  ADD COLUMN IF NOT EXISTS demand_category text NOT NULL DEFAULT 'measured_contact'
    CHECK (demand_category IN ('measured_contact', 'measured_case', 'hidden_internal', 'project_ad_hoc')),
  ADD COLUMN IF NOT EXISTS work_type_label text,
  ADD COLUMN IF NOT EXISTS frequency text NOT NULL DEFAULT 'monthly'
    CHECK (frequency IN ('monthly', 'weekly', 'daily', 'one_off'));

ALTER TABLE public.capacity_assumptions
  ADD COLUMN IF NOT EXISTS weeks_per_month numeric(8,2) NOT NULL DEFAULT 4.33,
  ADD COLUMN IF NOT EXISTS current_supply_fte numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assumption_notes text;

ALTER TABLE public.cost_assumptions
  ADD COLUMN IF NOT EXISTS annual_budget_target numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assumption_notes text;

ALTER TABLE public.calculation_runs
  ADD COLUMN IF NOT EXISTS measured_workload_hours numeric(18,2),
  ADD COLUMN IF NOT EXISTS estimated_workload_hours numeric(18,2),
  ADD COLUMN IF NOT EXISTS hidden_workload_hours numeric(18,2),
  ADD COLUMN IF NOT EXISTS risk_flags_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS calculation_output_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS scenario_summary_json jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_planning_briefs_org_plan ON public.planning_briefs(organisation_id, plan_id);
CREATE INDEX IF NOT EXISTS idx_source_inventory_org_plan ON public.source_inventory(organisation_id, plan_id);
CREATE INDEX IF NOT EXISTS idx_capacity_assumptions_org_plan ON public.capacity_assumptions(organisation_id, plan_id);
CREATE INDEX IF NOT EXISTS idx_cost_assumptions_org_plan ON public.cost_assumptions(organisation_id, plan_id);
CREATE INDEX IF NOT EXISTS idx_scenario_definitions_org_plan ON public.scenario_definitions(organisation_id, plan_id);
