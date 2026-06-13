import 'server-only';

import {
  assertValidDriverInput,
  buildDriverPhasingLines,
  buildImpactPreview,
  reconcileDriverLines,
  round2,
  type DriverImpactType,
  type DriverLineDraft,
  type DriverPlanningPeriod,
  type DriverStatus,
  type DriverWithLines,
  type ImpactPreview
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
  drivers: Record<string, unknown>[];
  driverLines: Record<string, unknown>[];
  periods: Record<string, unknown>[];
  preview: ImpactPreview | null;
  previewBaseline: Record<string, unknown> | null;
}

export interface DriverDetailData {
  driver: Record<string, unknown> | null;
  lines: Record<string, unknown>[];
  baseline: Record<string, unknown> | null;
  periods: Record<string, unknown>[];
  supersededBy: Record<string, unknown> | null;
  supersedes: Record<string, unknown> | null;
  auditEvents: Record<string, unknown>[];
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function numberFrom(value: unknown, fallback = 0): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapPeriod(row: Record<string, unknown>): DriverPlanningPeriod {
  return {
    id: String(row.id),
    periodNumber: numberFrom(row.period_number),
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    periodLabel: String(row.period_label ?? row.period_start)
  };
}

function toDriverWithLines(driver: Record<string, unknown>, lines: Record<string, unknown>[]): DriverWithLines {
  return {
    id: String(driver.id),
    impactType: String(driver.impact_type) as DriverImpactType,
    status: String(driver.status) as DriverStatus,
    lines: lines
      .filter((line) => String(line.forecast_driver_id) === String(driver.id))
      .map((line) => ({ periodId: String(line.period_id), impactAmount: numberFrom(line.impact_amount) }))
  };
}

export function canReadDrivers(context: UserContext): boolean {
  return hasPermission(context.roles, 'driver:read');
}

export function canWriteDrivers(context: UserContext): boolean {
  return hasPermission(context.roles, 'driver:write');
}

export function canProposeDrivers(context: UserContext): boolean {
  return hasPermission(context.roles, 'driver:propose');
}

export function canApproveDrivers(context: UserContext): boolean {
  return hasPermission(context.roles, 'driver:approve');
}

export function canSupersedeDrivers(context: UserContext): boolean {
  return hasPermission(context.roles, 'driver:supersede');
}

export async function getDriverDashboard(context: UserContext): Promise<DriverDashboardData> {
  requirePermission(context.roles, 'driver:read');
  const supabase = await createClient();
  const orgId = context.organisationId;

  const [plansRes, fiscalYearsRes, baselinesRes, driversRes, linesRes, periodsRes] = await Promise.all([
    supabase.from('plans').select('*').eq('organisation_id', orgId).order('created_at', { ascending: false }),
    supabase.from('fiscal_years').select('*').eq('organisation_id', orgId).order('start_date', { ascending: false }),
    supabase.from('budget_baselines').select('*').eq('organisation_id', orgId).eq('status', 'locked').order('locked_at', { ascending: false }),
    supabase.from('forecast_drivers').select('*').eq('organisation_id', orgId).order('created_at', { ascending: false }),
    supabase.from('forecast_driver_lines').select('*').eq('organisation_id', orgId).order('period_number', { ascending: true }),
    supabase.from('planning_periods').select('*').eq('organisation_id', orgId).order('period_start', { ascending: true })
  ]);

  const lockedBaselines = (baselinesRes.data ?? []) as Record<string, unknown>[];
  const drivers = (driversRes.data ?? []) as Record<string, unknown>[];
  const driverLines = (linesRes.data ?? []) as Record<string, unknown>[];

  const previewBaseline = lockedBaselines[0] ?? null;
  let preview: ImpactPreview | null = null;
  if (previewBaseline) {
    const { data: baselineLines } = await supabase
      .from('budget_baseline_lines')
      .select('*')
      .eq('organisation_id', orgId)
      .eq('budget_baseline_id', String(previewBaseline.id))
      .order('period_start', { ascending: true });

    const baselineDrivers = drivers.filter((driver) => String(driver.budget_baseline_id) === String(previewBaseline.id));
    preview = buildImpactPreview({
      baselineLines: ((baselineLines ?? []) as Record<string, unknown>[]).map((line) => ({
        periodId: String(line.period_id),
        periodStart: String(line.period_start),
        budgetAmount: numberFrom(line.budget_amount),
        labourCost: numberFrom(line.labour_cost),
        requiredFte: numberFrom(line.required_fte),
        workloadHours: numberFrom(line.workload_hours)
      })),
      approvedDrivers: baselineDrivers.filter((driver) => String(driver.status) === 'approved').map((driver) => toDriverWithLines(driver, driverLines)),
      proposedDrivers: baselineDrivers.filter((driver) => String(driver.status) === 'proposed').map((driver) => toDriverWithLines(driver, driverLines))
    });
  }

  return {
    plans: (plansRes.data ?? []) as Record<string, unknown>[],
    fiscalYears: (fiscalYearsRes.data ?? []) as Record<string, unknown>[],
    lockedBaselines,
    drivers,
    driverLines,
    periods: (periodsRes.data ?? []) as Record<string, unknown>[],
    preview,
    previewBaseline
  };
}

export async function getDriverDetail(context: UserContext, driverId: string): Promise<DriverDetailData> {
  requirePermission(context.roles, 'driver:read');
  const supabase = await createClient();
  const orgId = context.organisationId;

  const { data: driver } = await supabase
    .from('forecast_drivers')
    .select('*')
    .eq('organisation_id', orgId)
    .eq('id', driverId)
    .maybeSingle();

  if (!driver) {
    return { driver: null, lines: [], baseline: null, periods: [], supersededBy: null, supersedes: null, auditEvents: [] };
  }

  const record = driver as Record<string, unknown>;
  const [linesRes, baselineRes, periodsRes, auditRes] = await Promise.all([
    supabase.from('forecast_driver_lines').select('*').eq('organisation_id', orgId).eq('forecast_driver_id', driverId).order('period_number', { ascending: true }),
    supabase.from('budget_baselines').select('*').eq('organisation_id', orgId).eq('id', String(record.budget_baseline_id)).maybeSingle(),
    supabase.from('planning_periods').select('*').eq('organisation_id', orgId).eq('fiscal_year_id', String(record.fiscal_year_id)).order('period_start', { ascending: true }),
    supabase.from('audit_events').select('*').eq('organisation_id', orgId).eq('entity_type', 'forecast_driver').eq('entity_id', driverId).order('created_at', { ascending: false }).limit(50)
  ]);

  async function relatedDriver(id: unknown): Promise<Record<string, unknown> | null> {
    if (!id) return null;
    const { data } = await supabase.from('forecast_drivers').select('*').eq('organisation_id', orgId).eq('id', String(id)).maybeSingle();
    return (data as Record<string, unknown>) ?? null;
  }

  return {
    driver: record,
    lines: (linesRes.data ?? []) as Record<string, unknown>[],
    baseline: (baselineRes.data as Record<string, unknown>) ?? null,
    periods: (periodsRes.data ?? []) as Record<string, unknown>[],
    supersededBy: await relatedDriver(record.superseded_by_driver_id),
    supersedes: await relatedDriver(record.supersedes_driver_id),
    auditEvents: (auditRes.data ?? []) as Record<string, unknown>[]
  };
}

interface DriverFormValues {
  budgetBaselineId: string;
  driverName: string;
  category: string;
  impactType: string;
  annualImpactAmount: number;
  phasingModel: string;
  startPeriodId: string;
  endPeriodId: string;
  oneOffPeriodId: string;
  confidenceRating: string;
  commentary: string;
  reason: string;
}

export function parseDriverForm(values: Record<string, unknown>): DriverFormValues {
  return {
    budgetBaselineId: text(values.budget_baseline_id),
    driverName: text(values.driver_name),
    category: text(values.category),
    impactType: text(values.impact_type),
    annualImpactAmount: round2(numberFrom(values.annual_impact_amount)),
    phasingModel: text(values.phasing_model),
    startPeriodId: text(values.start_period_id),
    endPeriodId: text(values.end_period_id),
    oneOffPeriodId: text(values.one_off_period_id),
    confidenceRating: text(values.confidence_rating) || 'medium',
    commentary: text(values.commentary),
    reason: text(values.reason)
  };
}

async function buildLinesForForm(context: UserContext, form: DriverFormValues): Promise<{ lines: DriverLineDraft[]; fiscalYearId: string }> {
  const supabase = await createClient();
  const { data: baseline } = await supabase
    .from('budget_baselines')
    .select('*')
    .eq('organisation_id', context.organisationId)
    .eq('id', form.budgetBaselineId)
    .maybeSingle();
  if (!baseline) throw new Error('Budget baseline not found');
  const baselineRecord = baseline as Record<string, unknown>;
  if (String(baselineRecord.status) !== 'locked') throw new Error('Forecast drivers require a locked budget baseline');

  const { data: periodRows } = await supabase
    .from('planning_periods')
    .select('*')
    .eq('organisation_id', context.organisationId)
    .eq('fiscal_year_id', String(baselineRecord.fiscal_year_id))
    .order('period_start', { ascending: true });

  const periods = ((periodRows ?? []) as Record<string, unknown>[]).map(mapPeriod);
  const startPeriod = periods.find((period) => period.id === form.startPeriodId);
  const endPeriod = periods.find((period) => period.id === form.endPeriodId);
  if (!startPeriod || !endPeriod) throw new Error('Driver start and end periods must belong to the baseline fiscal year');
  const oneOffPeriod = form.oneOffPeriodId ? periods.find((period) => period.id === form.oneOffPeriodId) : null;
  if (form.phasingModel === 'one_off' && !oneOffPeriod) throw new Error('One-off drivers require a one-off period in the baseline fiscal year');

  assertValidDriverInput({
    driverName: form.driverName,
    category: form.category,
    impactType: form.impactType,
    annualImpactAmount: form.annualImpactAmount,
    phasingModel: form.phasingModel,
    confidenceRating: form.confidenceRating
  });

  const lines = buildDriverPhasingLines({
    periods,
    annualImpactAmount: form.annualImpactAmount,
    phasingModel: form.phasingModel as DriverLinePhasing,
    startPeriodNumber: startPeriod.periodNumber,
    endPeriodNumber: endPeriod.periodNumber,
    oneOffPeriodNumber: oneOffPeriod ? oneOffPeriod.periodNumber : null
  });

  const reconciliation = reconcileDriverLines(form.annualImpactAmount, lines);
  if (!reconciliation.reconciles) throw new Error('Driver phasing failed deterministic reconciliation');

  return { lines, fiscalYearId: String(baselineRecord.fiscal_year_id) };
}

type DriverLinePhasing = Parameters<typeof buildDriverPhasingLines>[0]['phasingModel'];

function driverPayloadFrom(form: DriverFormValues): Json {
  return {
    budget_baseline_id: form.budgetBaselineId,
    driver_name: form.driverName,
    category: form.category,
    impact_type: form.impactType,
    annual_impact_amount: form.annualImpactAmount,
    phasing_model: form.phasingModel,
    start_period_id: form.startPeriodId,
    end_period_id: form.endPeriodId,
    one_off_period_id: form.oneOffPeriodId || null,
    confidence_rating: form.confidenceRating,
    commentary: form.commentary || null
  } as Json;
}

function linePayloadsFrom(lines: DriverLineDraft[]): Json {
  return lines.map((line) => ({
    period_id: line.periodId,
    period_number: line.periodNumber,
    period_start: line.periodStart,
    period_end: line.periodEnd,
    impact_amount: line.impactAmount
  })) as Json;
}

export async function createForecastDriver(context: UserContext, values: Record<string, unknown>): Promise<string> {
  requirePermission(context.roles, 'driver:write');
  const form = parseDriverForm(values);
  const { lines } = await buildLinesForForm(context, form);

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('create_forecast_driver', {
    target_organisation_id: context.organisationId,
    target_actor_user_id: context.userId,
    driver_payload: driverPayloadFrom(form),
    line_payloads: linePayloadsFrom(lines),
    create_reason: form.reason || null
  });
  if (error) throw new Error(`Could not create forecast driver: ${error.message}`);
  return String((data as Record<string, unknown> | null)?.id ?? '');
}

export async function updateForecastDriverDraft(context: UserContext, driverId: string, values: Record<string, unknown>): Promise<void> {
  requirePermission(context.roles, 'driver:write');
  const form = parseDriverForm(values);
  const { lines } = await buildLinesForForm(context, form);

  const admin = createAdminClient();
  const { error } = await admin.rpc('update_forecast_driver_draft', {
    target_organisation_id: context.organisationId,
    target_actor_user_id: context.userId,
    target_driver_id: driverId,
    driver_payload: driverPayloadFrom(form),
    line_payloads: linePayloadsFrom(lines),
    update_reason: form.reason || null
  });
  if (error) throw new Error(`Could not update forecast driver: ${error.message}`);
}

const transitionPermissionByStatus: Record<string, Parameters<typeof requirePermission>[1]> = {
  proposed: 'driver:propose',
  draft: 'driver:propose',
  approved: 'driver:approve',
  voided: 'driver:supersede'
};

export async function transitionForecastDriverStatus(context: UserContext, driverId: string, nextStatus: string, reason: string): Promise<void> {
  const permission = transitionPermissionByStatus[nextStatus];
  if (!permission) throw new Error(`Unknown forecast driver transition: ${nextStatus}`);
  requirePermission(context.roles, permission);

  const admin = createAdminClient();
  const { error } = await admin.rpc('transition_forecast_driver_status', {
    target_organisation_id: context.organisationId,
    target_actor_user_id: context.userId,
    target_driver_id: driverId,
    next_status: nextStatus,
    transition_reason: reason || null
  });
  if (error) throw new Error(`Forecast driver transition failed: ${error.message}`);
}

export async function supersedeForecastDriver(context: UserContext, driverId: string, values: Record<string, unknown>): Promise<string> {
  requirePermission(context.roles, 'driver:supersede');
  const form = parseDriverForm(values);
  const { lines } = await buildLinesForForm(context, form);

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('supersede_forecast_driver', {
    target_organisation_id: context.organisationId,
    target_actor_user_id: context.userId,
    target_driver_id: driverId,
    replacement_payload: driverPayloadFrom(form),
    replacement_lines: linePayloadsFrom(lines),
    supersede_reason: form.reason || null
  });
  if (error) throw new Error(`Could not supersede forecast driver: ${error.message}`);
  return String((data as Record<string, unknown> | null)?.id ?? '');
}
