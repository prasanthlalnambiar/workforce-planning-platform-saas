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
import { requirePermission } from '../permissions/permissions';
import { createAdminClient } from '../supabase/admin';
import { createClient } from '../supabase/server';
import type { Json } from '../../types/database';
import type { UserContext } from '../../types/models';

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
