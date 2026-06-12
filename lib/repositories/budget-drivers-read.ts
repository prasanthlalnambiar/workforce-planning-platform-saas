import 'server-only';

import { hasPermission, requirePermission } from '../permissions/permissions';
import { createClient } from '../supabase/server';
import type { UserContext } from '../../types/models';

export interface DriverDashboardData {
  plans: Record<string, unknown>[];
  fiscalYears: Record<string, unknown>[];
  lockedBaselines: Record<string, unknown>[];
  driverSets: Record<string, unknown>[];
  drivers: Record<string, unknown>[];
  monthlyImpacts: Record<string, unknown>[];
  officialSummary: DriverSummary;
  proposedSummary: DriverSummary;
}

export interface DriverDetailData {
  driver: Record<string, unknown>;
  driverSet: Record<string, unknown> | null;
  baseline: Record<string, unknown> | null;
  monthlyImpacts: Record<string, unknown>[];
  auditEvents: Record<string, unknown>[];
}

export interface DriverSummary {
  budgetDelta: number;
  labourCostDelta: number;
  requiredFteDelta: number;
  workloadHoursDelta: number;
}

function numberFrom(value: unknown, fallback = 0): number {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function emptySummary(): DriverSummary {
  return { budgetDelta: 0, labourCostDelta: 0, requiredFteDelta: 0, workloadHoursDelta: 0 };
}

function summariseRows(rows: Record<string, unknown>[]): DriverSummary {
  return rows.reduce((summary, row) => ({
    budgetDelta: summary.budgetDelta + numberFrom(row.budget_delta),
    labourCostDelta: summary.labourCostDelta + numberFrom(row.labour_cost_delta),
    requiredFteDelta: summary.requiredFteDelta + numberFrom(row.required_fte_delta),
    workloadHoursDelta: summary.workloadHoursDelta + numberFrom(row.workload_hours_delta)
  }), emptySummary());
}

export async function getBudgetDriverDashboard(context: UserContext): Promise<DriverDashboardData> {
  requirePermission(context.roles, 'driver:read');
  const supabase = await createClient();
  const [plans, fiscalYears, lockedBaselines, driverSets, drivers, monthlyImpacts] = await Promise.all([
    supabase.from('plans').select('id, plan_name, status').eq('organisation_id', context.organisationId).order('created_at', { ascending: false }),
    supabase.from('fiscal_years').select('id, plan_id, fiscal_year_label, start_date, end_date, status').eq('organisation_id', context.organisationId).order('start_date', { ascending: false }),
    supabase.from('budget_baselines').select('*').eq('organisation_id', context.organisationId).eq('status', 'locked').order('locked_at', { ascending: false }),
    supabase.from('budget_driver_sets').select('*').eq('organisation_id', context.organisationId).order('created_at', { ascending: false }),
    supabase.from('budget_drivers').select('*').eq('organisation_id', context.organisationId).order('created_at', { ascending: false }).limit(50),
    supabase.from('budget_driver_monthly_impacts').select('*').eq('organisation_id', context.organisationId).order('period_start', { ascending: true }).limit(120)
  ]);
  for (const result of [plans, fiscalYears, lockedBaselines, driverSets, drivers, monthlyImpacts]) {
    if (result.error) throw result.error;
  }
  return {
    plans: plans.data ?? [],
    fiscalYears: fiscalYears.data ?? [],
    lockedBaselines: lockedBaselines.data ?? [],
    driverSets: driverSets.data ?? [],
    drivers: drivers.data ?? [],
    monthlyImpacts: monthlyImpacts.data ?? [],
    officialSummary: summariseRows((monthlyImpacts.data ?? []).filter((impact) => String(impact.impact_treatment) === 'official_impact')),
    proposedSummary: summariseRows((monthlyImpacts.data ?? []).filter((impact) => String(impact.impact_treatment) === 'scenario_preview'))
  };
}

export async function getBudgetDriverDetail(context: UserContext, driverId: string): Promise<DriverDetailData> {
  requirePermission(context.roles, 'driver:read');
  const supabase = await createClient();
  const { data: driver, error: driverError } = await supabase
    .from('budget_drivers')
    .select('*')
    .eq('organisation_id', context.organisationId)
    .eq('id', driverId)
    .single();
  if (driverError) throw driverError;

  const [driverSet, baseline, monthlyImpacts, auditEvents] = await Promise.all([
    supabase.from('budget_driver_sets').select('*').eq('organisation_id', context.organisationId).eq('id', String(driver.driver_set_id)).maybeSingle(),
    supabase.from('budget_baselines').select('*').eq('organisation_id', context.organisationId).eq('id', String(driver.budget_baseline_id)).maybeSingle(),
    supabase.from('budget_driver_monthly_impacts').select('*').eq('organisation_id', context.organisationId).eq('budget_driver_id', driverId).order('period_start', { ascending: true }),
    supabase.from('audit_events').select('*').eq('organisation_id', context.organisationId).eq('entity_type', 'budget_driver').eq('entity_id', driverId).order('created_at', { ascending: false }).limit(20)
  ]);
  for (const result of [driverSet, baseline, monthlyImpacts, auditEvents]) {
    if (result.error) throw result.error;
  }
  return {
    driver,
    driverSet: driverSet.data ?? null,
    baseline: baseline.data ?? null,
    monthlyImpacts: monthlyImpacts.data ?? [],
    auditEvents: auditEvents.data ?? []
  };
}

export function canCreateDriverSet(context: UserContext): boolean {
  return hasPermission(context.roles, 'driver:create');
}

export function canWriteDrivers(context: UserContext): boolean {
  return hasPermission(context.roles, 'driver:write');
}

export function canReviewDrivers(context: UserContext): boolean {
  return hasPermission(context.roles, 'driver:review');
}
