import 'server-only';

import {
  buildDriverInclusionSnapshot,
  buildReforecastLines,
  buildScenarioOverlay,
  computeReforecastChecksum,
  reconcileReforecastLines,
  summariseReforecast,
  type ReforecastDriverInput,
  type ReforecastLineDraft,
  type ReforecastDriverImpactDraft,
  type ReforecastTotals,
  type ScenarioOverlayRow
} from '../reforecast/reforecast-engine';
import type { DriverCategory, DriverImpactType, DriverStatus } from '../drivers/driver-engine';
import { hasPermission, requirePermission } from '../permissions/permissions';
import { createAdminClient } from '../supabase/admin';
import { createClient } from '../supabase/server';
import type { Json } from '../../types/database';
import type { UserContext } from '../../types/models';

type JsonRecord = Record<string, unknown>;

function numberFrom(value: unknown, fallback = 0): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function canReadReforecasts(context: UserContext): boolean {
  return hasPermission(context.roles, 'reforecast:read');
}
export function canCreateReforecasts(context: UserContext): boolean {
  return hasPermission(context.roles, 'reforecast:create');
}
export function canWriteReforecasts(context: UserContext): boolean {
  return hasPermission(context.roles, 'reforecast:write');
}
export function canSubmitReforecasts(context: UserContext): boolean {
  return hasPermission(context.roles, 'reforecast:submit');
}
export function canLockReforecasts(context: UserContext): boolean {
  return hasPermission(context.roles, 'reforecast:lock');
}
export function canVoidReforecasts(context: UserContext): boolean {
  return hasPermission(context.roles, 'reforecast:void');
}

function mapDriver(driver: JsonRecord, lines: JsonRecord[]): ReforecastDriverInput {
  return {
    id: String(driver.id),
    driverCode: String(driver.driver_code),
    driverName: String(driver.driver_name),
    category: String(driver.category) as DriverCategory,
    impactType: String(driver.impact_type) as DriverImpactType,
    status: String(driver.status) as DriverStatus,
    annualImpactAmount: numberFrom(driver.annual_impact_amount),
    lines: lines
      .filter((line) => String(line.forecast_driver_id) === String(driver.id))
      .map((line) => ({ periodId: String(line.period_id), impactAmount: numberFrom(line.impact_amount) }))
  };
}

async function loadCalculationInputs(context: UserContext, baselineId: string) {
  const supabase = await createClient();
  const orgId = context.organisationId;

  const { data: baseline } = await supabase
    .from('budget_baselines')
    .select('*')
    .eq('organisation_id', orgId)
    .eq('id', baselineId)
    .maybeSingle();
  if (!baseline) throw new Error('Budget baseline not found');
  const baselineRecord = baseline as JsonRecord;
  if (String(baselineRecord.status) !== 'locked') throw new Error('Reforecasts can only be created from a locked budget baseline');

  const [baselineLinesRes, driversRes, driverLinesRes] = await Promise.all([
    supabase.from('budget_baseline_lines').select('*').eq('organisation_id', orgId).eq('budget_baseline_id', baselineId).order('period_start', { ascending: true }),
    supabase.from('forecast_drivers').select('*').eq('organisation_id', orgId).eq('budget_baseline_id', baselineId),
    supabase.from('forecast_driver_lines').select('*').eq('organisation_id', orgId).order('period_number', { ascending: true })
  ]);

  const drivers = (driversRes.data ?? []) as JsonRecord[];
  const driverLines = (driverLinesRes.data ?? []) as JsonRecord[];
  const baselineLines = ((baselineLinesRes.data ?? []) as JsonRecord[]).map((line, index) => ({
    periodId: String(line.period_id),
    periodNumber: numberFrom(line.period_number, index + 1),
    periodStart: String(line.period_start),
    periodEnd: String(line.period_end),
    budgetAmount: numberFrom(line.budget_amount),
    labourCost: numberFrom(line.labour_cost),
    requiredFte: numberFrom(line.required_fte),
    workloadHours: numberFrom(line.workload_hours)
  }));

  const approvedDrivers = drivers.filter((driver) => String(driver.status) === 'approved').map((driver) => mapDriver(driver, driverLines));
  const proposedDrivers = drivers.filter((driver) => String(driver.status) === 'proposed').map((driver) => mapDriver(driver, driverLines));

  return { baselineRecord, baselineLines, approvedDrivers, proposedDrivers };
}

export interface ReforecastCalculation {
  lines: ReforecastLineDraft[];
  impacts: ReforecastDriverImpactDraft[];
  checksum: string;
  totals: ReforecastTotals;
  scenario: ScenarioOverlayRow[];
  proposedDriverCount: number;
}

export async function calculateWorkingForecast(context: UserContext, baselineId: string): Promise<ReforecastCalculation> {
  const inputs = await loadCalculationInputs(context, baselineId);
  const lines = buildReforecastLines({ baselineLines: inputs.baselineLines, approvedDrivers: inputs.approvedDrivers });
  const reconciliation = reconcileReforecastLines(lines);
  if (!reconciliation.reconciles) throw new Error('Reforecast calculation failed deterministic reconciliation');
  const impacts = buildDriverInclusionSnapshot(inputs.approvedDrivers);
  return {
    lines,
    impacts,
    checksum: computeReforecastChecksum(lines, impacts),
    totals: summariseReforecast(lines),
    scenario: buildScenarioOverlay({ officialLines: lines, proposedDrivers: inputs.proposedDrivers }),
    proposedDriverCount: inputs.proposedDrivers.length
  };
}

function linePayloads(lines: ReforecastLineDraft[]): Json {
  return lines.map((line) => ({
    period_id: line.periodId,
    period_number: line.periodNumber,
    period_start: line.periodStart,
    period_end: line.periodEnd,
    baseline_budget_amount: line.baselineBudgetAmount,
    baseline_labour_cost: line.baselineLabourCost,
    baseline_required_fte: line.baselineRequiredFte,
    baseline_workload_hours: line.baselineWorkloadHours,
    growth_cost_impact: line.growthCostImpact,
    efficiency_cost_impact: line.efficiencyCostImpact,
    cost_change_cost_impact: line.costChangeCostImpact,
    supply_change_cost_impact: line.supplyChangeCostImpact,
    management_adjustment_cost_impact: line.managementAdjustmentCostImpact,
    total_cost_impact: line.totalCostImpact,
    total_fte_impact: line.totalFteImpact,
    total_workload_hours_impact: line.totalWorkloadHoursImpact,
    forecast_budget_amount: line.forecastBudgetAmount,
    forecast_labour_cost: line.forecastLabourCost,
    forecast_required_fte: line.forecastRequiredFte,
    forecast_workload_hours: line.forecastWorkloadHours
  })) as Json;
}

function impactPayloads(impacts: ReforecastDriverImpactDraft[]): Json {
  return impacts.map((impact) => ({
    forecast_driver_id: impact.forecastDriverId,
    driver_code: impact.driverCode,
    driver_name: impact.driverName,
    category: impact.category,
    impact_type: impact.impactType,
    annual_impact_amount: impact.annualImpactAmount,
    driver_status_at_calculation: impact.driverStatusAtCalculation
  })) as Json;
}

export async function createDraftReforecast(context: UserContext, baselineId: string, reforecastName: string, reason: string): Promise<string> {
  requirePermission(context.roles, 'reforecast:create');
  if (!reforecastName.trim()) throw new Error('Reforecast name is required');
  const calculation = await calculateWorkingForecast(context, baselineId);

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('create_reforecast', {
    target_organisation_id: context.organisationId,
    target_actor_user_id: context.userId,
    reforecast_payload: { budget_baseline_id: baselineId, reforecast_name: reforecastName.trim(), calculation_checksum: calculation.checksum } as Json,
    line_payloads: linePayloads(calculation.lines),
    impact_payloads: impactPayloads(calculation.impacts),
    create_reason: reason || null
  });
  if (error) throw new Error(`Could not create reforecast: ${error.message}`);
  return String((data as JsonRecord | null)?.id ?? '');
}

export async function recalculateReforecast(context: UserContext, reforecastId: string, reason: string): Promise<void> {
  requirePermission(context.roles, 'reforecast:write');
  const supabase = await createClient();
  const { data: reforecast } = await supabase
    .from('reforecasts')
    .select('*')
    .eq('organisation_id', context.organisationId)
    .eq('id', reforecastId)
    .maybeSingle();
  if (!reforecast) throw new Error('Reforecast not found');
  const record = reforecast as JsonRecord;
  if (String(record.status) !== 'draft') throw new Error('Only draft reforecasts can be recalculated');

  const calculation = await calculateWorkingForecast(context, String(record.budget_baseline_id));
  const admin = createAdminClient();
  const { error } = await admin.rpc('recalculate_reforecast', {
    target_organisation_id: context.organisationId,
    target_actor_user_id: context.userId,
    target_reforecast_id: reforecastId,
    reforecast_payload: { calculation_checksum: calculation.checksum } as Json,
    line_payloads: linePayloads(calculation.lines),
    impact_payloads: impactPayloads(calculation.impacts),
    recalculate_reason: reason || null
  });
  if (error) throw new Error(`Could not recalculate reforecast: ${error.message}`);
}

const transitionPermissionByStatus: Record<string, Parameters<typeof requirePermission>[1]> = {
  in_review: 'reforecast:submit',
  draft: 'reforecast:submit',
  voided: 'reforecast:void'
};

export async function transitionReforecastStatus(context: UserContext, reforecastId: string, nextStatus: string, reason: string): Promise<void> {
  const permission = transitionPermissionByStatus[nextStatus];
  if (!permission) throw new Error(`Unknown reforecast transition: ${nextStatus}`);
  requirePermission(context.roles, permission);

  const admin = createAdminClient();
  const { error } = await admin.rpc('transition_reforecast_status', {
    target_organisation_id: context.organisationId,
    target_actor_user_id: context.userId,
    target_reforecast_id: reforecastId,
    next_status: nextStatus,
    transition_reason: reason || null
  });
  if (error) throw new Error(`Reforecast transition failed: ${error.message}`);
}

export async function lockReforecast(context: UserContext, reforecastId: string, reason: string): Promise<void> {
  requirePermission(context.roles, 'reforecast:lock');
  const supabase = await createClient();
  const orgId = context.organisationId;

  const { data: reforecast } = await supabase
    .from('reforecasts')
    .select('*')
    .eq('organisation_id', orgId)
    .eq('id', reforecastId)
    .maybeSingle();
  if (!reforecast) throw new Error('Reforecast not found');
  const record = reforecast as JsonRecord;
  if (String(record.status) !== 'in_review') throw new Error('Only reforecasts in review can be locked');

  const [linesRes, impactsRes] = await Promise.all([
    supabase.from('reforecast_lines').select('*').eq('organisation_id', orgId).eq('reforecast_id', reforecastId).order('period_number', { ascending: true }),
    supabase.from('reforecast_driver_impacts').select('*').eq('organisation_id', orgId).eq('reforecast_id', reforecastId)
  ]);

  const lines = ((linesRes.data ?? []) as JsonRecord[]).map((line) => ({
    periodId: String(line.period_id),
    periodNumber: numberFrom(line.period_number),
    periodStart: String(line.period_start),
    periodEnd: String(line.period_end),
    baselineBudgetAmount: numberFrom(line.baseline_budget_amount),
    baselineLabourCost: numberFrom(line.baseline_labour_cost),
    baselineRequiredFte: numberFrom(line.baseline_required_fte),
    baselineWorkloadHours: numberFrom(line.baseline_workload_hours),
    growthCostImpact: numberFrom(line.growth_cost_impact),
    efficiencyCostImpact: numberFrom(line.efficiency_cost_impact),
    costChangeCostImpact: numberFrom(line.cost_change_cost_impact),
    supplyChangeCostImpact: numberFrom(line.supply_change_cost_impact),
    managementAdjustmentCostImpact: numberFrom(line.management_adjustment_cost_impact),
    totalCostImpact: numberFrom(line.total_cost_impact),
    totalFteImpact: numberFrom(line.total_fte_impact),
    totalWorkloadHoursImpact: numberFrom(line.total_workload_hours_impact),
    forecastBudgetAmount: numberFrom(line.forecast_budget_amount),
    forecastLabourCost: numberFrom(line.forecast_labour_cost),
    forecastRequiredFte: numberFrom(line.forecast_required_fte),
    forecastWorkloadHours: numberFrom(line.forecast_workload_hours)
  }));

  const impacts = ((impactsRes.data ?? []) as JsonRecord[]).map((impact) => ({
    forecastDriverId: String(impact.forecast_driver_id),
    driverCode: String(impact.driver_code),
    driverName: String(impact.driver_name),
    category: String(impact.category) as DriverCategory,
    impactType: String(impact.impact_type) as DriverImpactType,
    annualImpactAmount: numberFrom(impact.annual_impact_amount),
    driverStatusAtCalculation: 'approved' as const
  }));

  const checksum = computeReforecastChecksum(lines, impacts);
  const totals = summariseReforecast(lines);

  const admin = createAdminClient();
  const { error } = await admin.rpc('lock_reforecast', {
    target_organisation_id: orgId,
    target_actor_user_id: context.userId,
    target_reforecast_id: reforecastId,
    snapshot_payload: {
      reforecast_code: record.reforecast_code,
      reforecast_name: record.reforecast_name,
      budget_baseline_id: record.budget_baseline_id,
      totals,
      lines: linePayloads(lines),
      driver_inclusions: impactPayloads(impacts)
    } as unknown as Json,
    lock_checksum: checksum,
    lock_reason: reason || null
  });
  if (error) throw new Error(`Could not lock reforecast: ${error.message}`);
}

export interface ReforecastDashboardData {
  plans: JsonRecord[];
  fiscalYears: JsonRecord[];
  lockedBaselines: JsonRecord[];
  reforecasts: JsonRecord[];
  currentLocked: JsonRecord | null;
}

export async function getReforecastDashboard(context: UserContext): Promise<ReforecastDashboardData> {
  requirePermission(context.roles, 'reforecast:read');
  const supabase = await createClient();
  const orgId = context.organisationId;

  const [plansRes, fiscalYearsRes, baselinesRes, reforecastsRes] = await Promise.all([
    supabase.from('plans').select('*').eq('organisation_id', orgId).order('created_at', { ascending: false }),
    supabase.from('fiscal_years').select('*').eq('organisation_id', orgId).order('start_date', { ascending: false }),
    supabase.from('budget_baselines').select('*').eq('organisation_id', orgId).eq('status', 'locked').order('locked_at', { ascending: false }),
    supabase.from('reforecasts').select('*').eq('organisation_id', orgId).order('created_at', { ascending: false })
  ]);

  const reforecasts = (reforecastsRes.data ?? []) as JsonRecord[];
  return {
    plans: (plansRes.data ?? []) as JsonRecord[],
    fiscalYears: (fiscalYearsRes.data ?? []) as JsonRecord[],
    lockedBaselines: (baselinesRes.data ?? []) as JsonRecord[],
    reforecasts,
    currentLocked: reforecasts.find((reforecast) => reforecast.is_current_locked === true) ?? null
  };
}

export interface ReforecastDetailData {
  reforecast: JsonRecord | null;
  lines: JsonRecord[];
  impacts: JsonRecord[];
  snapshots: JsonRecord[];
  baseline: JsonRecord | null;
  auditEvents: JsonRecord[];
  supersedes: JsonRecord | null;
  supersededBy: JsonRecord | null;
  scenario: ScenarioOverlayRow[];
  proposedDriverCount: number;
}

export async function getReforecastDetail(context: UserContext, reforecastId: string): Promise<ReforecastDetailData> {
  requirePermission(context.roles, 'reforecast:read');
  const supabase = await createClient();
  const orgId = context.organisationId;

  const { data: reforecast } = await supabase
    .from('reforecasts')
    .select('*')
    .eq('organisation_id', orgId)
    .eq('id', reforecastId)
    .maybeSingle();

  if (!reforecast) {
    return { reforecast: null, lines: [], impacts: [], snapshots: [], baseline: null, auditEvents: [], supersedes: null, supersededBy: null, scenario: [], proposedDriverCount: 0 };
  }

  const record = reforecast as JsonRecord;
  const [linesRes, impactsRes, snapshotsRes, baselineRes, auditRes] = await Promise.all([
    supabase.from('reforecast_lines').select('*').eq('organisation_id', orgId).eq('reforecast_id', reforecastId).order('period_number', { ascending: true }),
    supabase.from('reforecast_driver_impacts').select('*').eq('organisation_id', orgId).eq('reforecast_id', reforecastId).order('driver_code', { ascending: true }),
    supabase.from('reforecast_snapshots').select('id, organisation_id, reforecast_id, snapshot_type, checksum, created_at').eq('organisation_id', orgId).eq('reforecast_id', reforecastId).order('created_at', { ascending: false }),
    supabase.from('budget_baselines').select('*').eq('organisation_id', orgId).eq('id', String(record.budget_baseline_id)).maybeSingle(),
    supabase.from('audit_events').select('*').eq('organisation_id', orgId).eq('entity_type', 'reforecast').eq('entity_id', reforecastId).order('created_at', { ascending: false }).limit(50)
  ]);

  async function related(id: unknown): Promise<JsonRecord | null> {
    if (!id) return null;
    const { data } = await supabase.from('reforecasts').select('*').eq('organisation_id', orgId).eq('id', String(id)).maybeSingle();
    return (data as JsonRecord) ?? null;
  }

  // Scenario-only overlay from current proposed drivers; never persisted, never official.
  let scenario: ScenarioOverlayRow[] = [];
  let proposedDriverCount = 0;
  try {
    const inputs = await loadCalculationInputs(context, String(record.budget_baseline_id));
    proposedDriverCount = inputs.proposedDrivers.length;
    const officialLines = ((linesRes.data ?? []) as JsonRecord[]).map((line) => ({
      periodId: String(line.period_id),
      periodNumber: numberFrom(line.period_number),
      periodStart: String(line.period_start),
      periodEnd: String(line.period_end),
      baselineBudgetAmount: numberFrom(line.baseline_budget_amount),
      baselineLabourCost: numberFrom(line.baseline_labour_cost),
      baselineRequiredFte: numberFrom(line.baseline_required_fte),
      baselineWorkloadHours: numberFrom(line.baseline_workload_hours),
      growthCostImpact: numberFrom(line.growth_cost_impact),
      efficiencyCostImpact: numberFrom(line.efficiency_cost_impact),
      costChangeCostImpact: numberFrom(line.cost_change_cost_impact),
      supplyChangeCostImpact: numberFrom(line.supply_change_cost_impact),
      managementAdjustmentCostImpact: numberFrom(line.management_adjustment_cost_impact),
      totalCostImpact: numberFrom(line.total_cost_impact),
      totalFteImpact: numberFrom(line.total_fte_impact),
      totalWorkloadHoursImpact: numberFrom(line.total_workload_hours_impact),
      forecastBudgetAmount: numberFrom(line.forecast_budget_amount),
      forecastLabourCost: numberFrom(line.forecast_labour_cost),
      forecastRequiredFte: numberFrom(line.forecast_required_fte),
      forecastWorkloadHours: numberFrom(line.forecast_workload_hours)
    }));
    scenario = buildScenarioOverlay({ officialLines, proposedDrivers: inputs.proposedDrivers });
  } catch {
    scenario = [];
  }

  return {
    reforecast: record,
    lines: (linesRes.data ?? []) as JsonRecord[],
    impacts: (impactsRes.data ?? []) as JsonRecord[],
    snapshots: (snapshotsRes.data ?? []) as JsonRecord[],
    baseline: (baselineRes.data as JsonRecord) ?? null,
    auditEvents: (auditRes.data ?? []) as JsonRecord[],
    supersedes: await related(record.supersedes_reforecast_id),
    supersededBy: await related(record.superseded_by_reforecast_id),
    scenario,
    proposedDriverCount
  };
}
