import 'server-only';

import {
  isDriverCategory,
  isDriverDirection,
  isDriverImpactBasis,
  isDriverPhasingMethod,
  isDriverRiskRating,
  isDriverStatus,
  phaseDriverImpact,
  signedDriverValue,
  type DriverDirection,
  type DriverPhasingMethod,
  type DriverPlanningPeriod
} from '../drivers/driver-engine';
import { hasPermission, requirePermission } from '../permissions/permissions';
import { createAdminClient } from '../supabase/admin';
import { createClient } from '../supabase/server';
import type { Json } from '../../types/database';
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

type DriverLifecycleStatus = 'proposed' | 'approved' | 'superseded' | 'voided';

function nullableString(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function numberFrom(value: unknown, fallback = 0): number {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function toJson(value: unknown): Json {
  return value as Json;
}

function driverDirection(value: unknown): DriverDirection {
  const text = String(value ?? 'increase');
  return isDriverDirection(text) ? text : 'increase';
}

function riskRating(value: unknown) {
  const text = String(value ?? 'medium');
  return isDriverRiskRating(text) ? text : 'medium';
}

function impactBasis(value: unknown) {
  const text = String(value ?? 'multi_metric');
  return isDriverImpactBasis(text) ? text : 'multi_metric';
}

function phasingMethod(value: unknown): DriverPhasingMethod {
  const text = String(value ?? 'straight_line');
  return isDriverPhasingMethod(text) ? text : 'straight_line';
}

function oneOffPeriodIndex(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(Math.max(Math.trunc(parsed) - 1, 0), 11);
}

function driverCategory(value: unknown) {
  const text = String(value ?? '');
  if (!isDriverCategory(text)) throw new Error('Invalid driver category');
  return text;
}

function lifecycleStatus(value: unknown): DriverLifecycleStatus {
  const text = String(value ?? '');
  if (!isDriverStatus(text) || text === 'draft') throw new Error('Invalid driver lifecycle transition');
  return text;
}

function mapBaselineLine(row: Record<string, unknown>): DriverPlanningPeriod {
  return {
    periodId: String(row.period_id),
    budgetBaselineLineId: String(row.id),
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end)
  };
}

async function listBaselinePeriods(context: UserContext, baselineId: string): Promise<DriverPlanningPeriod[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('budget_baseline_lines')
    .select('id, period_id, period_start, period_end')
    .eq('organisation_id', context.organisationId)
    .eq('budget_baseline_id', baselineId)
    .order('period_start', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => mapBaselineLine(row));
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

export async function createBudgetDriverSetFromBaseline(context: UserContext, input: Record<string, unknown>) {
  requirePermission(context.roles, 'driver:create');
  const baselineId = String(input.budget_baseline_id ?? '');
  const driverSetName = nullableString(input.driver_set_name);
  if (!baselineId) throw new Error('Locked budget baseline is required');
  if (!driverSetName) throw new Error('Driver set name is required');

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('create_budget_driver_set_from_baseline', {
    target_organisation_id: context.organisationId,
    target_budget_baseline_id: baselineId,
    target_actor_user_id: context.userId,
    driver_set_payload: toJson({
      driver_set_name: driverSetName,
      notes: nullableString(input.notes)
    }),
    create_reason: 'Budget driver set created from locked baseline'
  });
  if (error) throw error;
  return data;
}

export async function createBudgetDriver(context: UserContext, input: Record<string, unknown>) {
  requirePermission(context.roles, 'driver:write');
  const driverSetId = String(input.driver_set_id ?? '');
  const driverName = nullableString(input.driver_name);
  if (!driverSetId) throw new Error('Driver set is required');
  if (!driverName) throw new Error('Driver name is required');

  const supabase = await createClient();
  const { data: driverSet, error: driverSetError } = await supabase
    .from('budget_driver_sets')
    .select('*')
    .eq('organisation_id', context.organisationId)
    .eq('id', driverSetId)
    .single();
  if (driverSetError) throw driverSetError;
  if (String(driverSet.status) !== 'draft' || driverSet.is_immutable === true) throw new Error('Only draft budget driver sets can be edited');

  const baselineId = String(driverSet.budget_baseline_id);
  const periods = await listBaselinePeriods(context, baselineId);
  if (periods.length !== 12) throw new Error('Budget drivers require 12 baseline monthly lines');

  const direction = driverDirection(input.driver_direction);
  const annualBudgetDelta = signedDriverValue(numberFrom(input.annual_budget_delta), direction);
  const annualLabourCostDelta = signedDriverValue(numberFrom(input.annual_labour_cost_delta), direction);
  const annualRequiredFteDelta = signedDriverValue(numberFrom(input.annual_required_fte_delta), direction);
  const annualWorkloadHoursDelta = signedDriverValue(numberFrom(input.annual_workload_hours_delta), direction);
  if (annualBudgetDelta === 0 && annualLabourCostDelta === 0 && annualRequiredFteDelta === 0 && annualWorkloadHoursDelta === 0) {
    throw new Error('At least one driver impact value is required');
  }

  const selectedPhasingMethod = phasingMethod(input.phasing_method);
  const monthlyImpacts = phaseDriverImpact(periods, {
    annualBudgetDelta,
    annualLabourCostDelta,
    annualRequiredFteDelta,
    annualWorkloadHoursDelta,
    phasingMethod: selectedPhasingMethod,
    oneOffPeriodIndex: oneOffPeriodIndex(input.one_off_period_number),
    notes: nullableString(input.impact_notes)
  });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('create_budget_driver', {
    target_organisation_id: context.organisationId,
    target_driver_set_id: driverSetId,
    target_actor_user_id: context.userId,
    driver_payload: toJson({
      driver_name: driverName,
      driver_category: driverCategory(input.driver_category),
      driver_direction: direction,
      impact_basis: impactBasis(input.impact_basis),
      phasing_method: selectedPhasingMethod,
      annual_budget_delta: annualBudgetDelta,
      annual_labour_cost_delta: annualLabourCostDelta,
      annual_required_fte_delta: annualRequiredFteDelta,
      annual_workload_hours_delta: annualWorkloadHoursDelta,
      confidence_score: numberFrom(input.confidence_score, 70),
      evidence_quality_score: numberFrom(input.evidence_quality_score, 70),
      risk_rating: riskRating(input.risk_rating),
      rationale: nullableString(input.rationale),
      supersedes_driver_id: nullableString(input.supersedes_driver_id)
    }),
    impact_payloads: toJson(monthlyImpacts.map((impact) => ({
      budget_baseline_line_id: impact.budgetBaselineLineId,
      period_id: impact.periodId,
      period_start: impact.periodStart,
      period_end: impact.periodEnd,
      budget_delta: impact.budgetDelta,
      labour_cost_delta: impact.labourCostDelta,
      required_fte_delta: impact.requiredFteDelta,
      workload_hours_delta: impact.workloadHoursDelta,
      phasing_method: impact.phasingMethod,
      notes: impact.notes
    }))),
    create_reason: 'Budget driver created with monthly impacts'
  });
  if (error) throw error;
  return data;
}

export async function reviewBudgetDriverSet(context: UserContext, driverSetId: string, notes?: string | null) {
  requirePermission(context.roles, 'driver:review');
  if (!driverSetId) throw new Error('Driver set is required');
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('review_budget_driver_set', {
    target_organisation_id: context.organisationId,
    target_driver_set_id: driverSetId,
    target_actor_user_id: context.userId,
    review_reason: notes ?? 'Budget driver set reviewed'
  });
  if (error) throw error;
  return data;
}

export async function transitionBudgetDriverLifecycle(context: UserContext, input: Record<string, unknown>) {
  const nextStatus = lifecycleStatus(input.next_status);
  if (nextStatus === 'proposed') requirePermission(context.roles, 'driver:write');
  else requirePermission(context.roles, 'driver:review');

  const driverId = String(input.driver_id ?? '');
  if (!driverId) throw new Error('Driver is required');
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('transition_budget_driver_lifecycle', {
    target_organisation_id: context.organisationId,
    target_budget_driver_id: driverId,
    target_actor_user_id: context.userId,
    next_status: nextStatus,
    transition_payload: toJson({
      superseded_by_driver_id: nullableString(input.superseded_by_driver_id)
    }),
    transition_reason: nullableString(input.transition_reason) ?? `Budget driver moved to ${nextStatus}`
  });
  if (error) throw error;
  return data;
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
