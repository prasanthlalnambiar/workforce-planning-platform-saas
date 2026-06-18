import 'server-only';

import {
  assessWaterfallReadiness,
  buildWaterfallBridge,
  validatePinnedSources,
  type BridgeReforecastLine,
  type BridgeVarianceLine,
  type WaterfallBridge,
  type WaterfallReadiness
} from '../waterfall/waterfall-engine';
import { hasPermission, requirePermission } from '../permissions/permissions';
import { maybe, rows } from './read-result';
import { createClient } from '../supabase/server';
import type { UserContext } from '../../types/models';

type JsonRecord = Record<string, unknown>;

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown, fallback = ''): string {
  const candidate = String(value ?? '').trim();
  return candidate || fallback;
}

function textOrNull(value: unknown): string | null {
  const candidate = String(value ?? '').trim();
  return candidate || null;
}

export function canReadWaterfall(context: UserContext): boolean {
  return hasPermission(context.roles, 'waterfall:read');
}

export interface WaterfallContext {
  plan: JsonRecord | null;
  fiscalYear: JsonRecord | null;
  baseline: JsonRecord | null;
  reforecast: JsonRecord | null;
  actualsBatch: JsonRecord | null;
  varianceReport: JsonRecord | null;
}

export interface WaterfallDashboardData {
  readiness: WaterfallReadiness;
  lockedVarianceReports: JsonRecord[];
  plans: JsonRecord[];
  fiscalYears: JsonRecord[];
  hasLockedBaseline: boolean;
  hasLockedForecast: boolean;
  hasPostedActuals: boolean;
  hasLockedVariance: boolean;
}

/**
 * Dashboard: which locked variance reports can anchor a waterfall, plus the
 * availability of each upstream locked source for controlled-state messaging.
 * Read-only. Every read is routed through rows()/maybe() so a database/RLS/
 * schema failure surfaces as a controlled module error (rendered by the
 * waterfall error boundary) rather than masquerading as an empty register.
 */
export async function getWaterfallDashboard(context: UserContext): Promise<WaterfallDashboardData> {
  requirePermission(context.roles, 'waterfall:read');
  const supabase = await createClient();
  const orgId = context.organisationId;

  const [plansRes, fiscalYearsRes, baselinesRes, reforecastsRes, actualsRes, varianceRes] = await Promise.all([
    supabase.from('plans').select('*').eq('organisation_id', orgId).order('created_at', { ascending: false }),
    supabase.from('fiscal_years').select('*').eq('organisation_id', orgId).order('start_date', { ascending: false }),
    supabase.from('budget_baselines').select('id').eq('organisation_id', orgId).eq('status', 'locked').limit(1),
    supabase.from('reforecasts').select('id').eq('organisation_id', orgId).in('status', ['locked', 'superseded']).limit(1),
    supabase.from('actuals_batches').select('id').eq('organisation_id', orgId).eq('status', 'posted').limit(1),
    // Only LOCKED variance reports may anchor a waterfall. Superseded reports
    // were locked and remain valid immutable anchors for historical bridges.
    supabase.from('variance_reports').select('*').eq('organisation_id', orgId).in('status', ['locked', 'superseded']).order('locked_at', { ascending: false })
  ]);

  const lockedBaselineRows = rows<JsonRecord>('locked baselines', baselinesRes as never);
  const lockedForecastRows = rows<JsonRecord>('locked forecasts', reforecastsRes as never);
  const postedActualsRows = rows<JsonRecord>('posted actuals', actualsRes as never);
  const lockedVarianceReports = rows<JsonRecord>('the waterfall anchors', varianceRes as never);

  const hasLockedBaseline = lockedBaselineRows.length > 0;
  const hasLockedForecast = lockedForecastRows.length > 0;
  const hasPostedActuals = postedActualsRows.length > 0;
  const hasLockedVariance = lockedVarianceReports.length > 0;

  const readiness = assessWaterfallReadiness({
    hasLockedBaseline, hasLockedForecast, hasPostedActuals, hasLockedVariance,
    hasReforecastLines: true, hasVarianceLines: true
  });

  return {
    readiness,
    lockedVarianceReports,
    plans: rows<JsonRecord>('plans', plansRes as never),
    fiscalYears: rows<JsonRecord>('fiscal years', fiscalYearsRes as never),
    hasLockedBaseline, hasLockedForecast, hasPostedActuals, hasLockedVariance
  };
}

export interface WaterfallDetailData {
  readiness: WaterfallReadiness;
  context: WaterfallContext;
  bridge: WaterfallBridge | null;
  reconciliationError: string | null;
  pinnedSourceIssues: string[];
}

const EMPTY_CONTEXT: WaterfallContext = {
  plan: null, fiscalYear: null, baseline: null, reforecast: null, actualsBatch: null, varianceReport: null
};

/**
 * Detail: build the deterministic bridge for one locked variance report, read
 * only from its pinned, immutable sources. Never reads draft/unlocked objects,
 * never silently calculates from inconsistent pins, and surfaces real read
 * errors as controlled module errors (not empty states).
 */
export async function getWaterfallDetail(context: UserContext, varianceReportId: string): Promise<WaterfallDetailData> {
  requirePermission(context.roles, 'waterfall:read');
  const supabase = await createClient();
  const orgId = context.organisationId;

  const reportRes = await supabase
    .from('variance_reports').select('*').eq('organisation_id', orgId).eq('id', varianceReportId).maybeSingle();
  const report = maybe<JsonRecord>('the variance report', reportRes as never);

  // The anchor must be a locked (or formerly-locked, now superseded) variance
  // report. Draft and voided reports never feed the official waterfall. (A
  // genuinely missing report is a not-found, handled by the page.)
  if (!report) {
    return { readiness: 'no_locked_variance', context: EMPTY_CONTEXT, bridge: null, reconciliationError: null, pinnedSourceIssues: [] };
  }
  if (!['locked', 'superseded'].includes(text(report.status))) {
    return { readiness: 'inconsistent_pinned_sources', context: { ...EMPTY_CONTEXT, varianceReport: report }, bridge: null, reconciliationError: null, pinnedSourceIssues: [`Variance anchor is not locked (status: ${text(report.status, 'unknown')}).`] };
  }

  const [planRes, fyRes, baselineRes, reforecastRes, actualsRes, reforecastLinesRes, varianceLinesRes, periodsRes] = await Promise.all([
    supabase.from('plans').select('*').eq('organisation_id', orgId).eq('id', text(report.plan_id)).maybeSingle(),
    supabase.from('fiscal_years').select('*').eq('organisation_id', orgId).eq('id', text(report.fiscal_year_id)).maybeSingle(),
    supabase.from('budget_baselines').select('*').eq('organisation_id', orgId).eq('id', text(report.baseline_id)).maybeSingle(),
    supabase.from('reforecasts').select('*').eq('organisation_id', orgId).eq('id', text(report.reforecast_id)).maybeSingle(),
    supabase.from('actuals_batches').select('*').eq('organisation_id', orgId).eq('id', text(report.actuals_batch_id)).maybeSingle(),
    supabase.from('reforecast_lines').select('*').eq('organisation_id', orgId).eq('reforecast_id', text(report.reforecast_id)).order('period_number', { ascending: true }),
    supabase.from('variance_lines').select('*').eq('organisation_id', orgId).eq('variance_report_id', varianceReportId).order('period_number', { ascending: true }),
    supabase.from('planning_periods').select('*').eq('organisation_id', orgId).eq('fiscal_year_id', text(report.fiscal_year_id))
  ]);

  // Surface real read errors as controlled module errors (not empty states).
  const baseline = maybe<JsonRecord>('the pinned baseline', baselineRes as never);
  const reforecast = maybe<JsonRecord>('the pinned forecast', reforecastRes as never);
  const actualsBatch = maybe<JsonRecord>('the pinned actuals batch', actualsRes as never);
  const reforecastRows = rows<JsonRecord>('the pinned forecast lines', reforecastLinesRes as never);
  const varianceRows = rows<JsonRecord>('the pinned variance lines', varianceLinesRes as never);
  const periodRows = rows<JsonRecord>('the planning periods', periodsRes as never);

  const ctx: WaterfallContext = {
    plan: maybe<JsonRecord>('the plan', planRes as never),
    fiscalYear: maybe<JsonRecord>('the fiscal year', fyRes as never),
    baseline,
    reforecast,
    actualsBatch,
    varianceReport: report
  };

  // Enforce upstream governed statuses AND pin consistency before building.
  const pinnedSourceIssues = validatePinnedSources(
    {
      baselineStatus: textOrNull(baseline?.status),
      reforecastStatus: textOrNull(reforecast?.status),
      actualsStatus: textOrNull(actualsBatch?.status),
      varianceStatus: textOrNull(report.status)
    },
    {
      comparatorLockVersionId: textOrNull(report.comparator_lock_version_id),
      comparatorChecksum: textOrNull(report.comparator_checksum),
      actualsChecksum: textOrNull(report.actuals_checksum),
      actualsVersionNumber: numOrNull(report.actuals_version_number),
      baselineChecksum: textOrNull(report.baseline_checksum),
      reforecastLockVersionId: textOrNull(reforecast?.lock_version_id),
      reforecastChecksum: textOrNull(reforecast?.checksum),
      actualsBatchChecksum: textOrNull(actualsBatch?.checksum),
      actualsBatchVersionNumber: numOrNull(actualsBatch?.version_number),
      budgetBaselineChecksum: textOrNull(baseline?.checksum)
    }
  );
  if (pinnedSourceIssues.length > 0) {
    return { readiness: 'inconsistent_pinned_sources', context: ctx, bridge: null, reconciliationError: null, pinnedSourceIssues };
  }

  // Controlled state: a locked report with no pinned lines is incomplete.
  if (reforecastRows.length === 0 || varianceRows.length === 0) {
    return { readiness: 'incomplete_inputs', context: ctx, bridge: null, reconciliationError: null, pinnedSourceIssues: [] };
  }

  const periodLabelById = new Map(periodRows.map((row) => [text(row.id), text(row.period_label, text(row.period_start))]));

  const reforecastLines: BridgeReforecastLine[] = reforecastRows.map((row) => ({
    planningPeriodId: text(row.period_id),
    periodNumber: num(row.period_number),
    baselineBudgetAmount: num(row.baseline_budget_amount),
    growthCostImpact: num(row.growth_cost_impact),
    efficiencyCostImpact: num(row.efficiency_cost_impact),
    costChangeCostImpact: num(row.cost_change_cost_impact),
    supplyChangeCostImpact: num(row.supply_change_cost_impact),
    managementAdjustmentCostImpact: num(row.management_adjustment_cost_impact),
    forecastBudgetAmount: num(row.forecast_budget_amount)
  }));

  const varianceLines: BridgeVarianceLine[] = varianceRows.map((row) => ({
    planningPeriodId: text(row.planning_period_id),
    periodNumber: num(row.period_number),
    periodLabel: periodLabelById.get(text(row.planning_period_id)) ?? text(row.period_start),
    actualCost: num(row.actual_cost),
    forecastCost: num(row.forecast_cost),
    baselineCost: num(row.baseline_cost),
    costVarianceToForecast: num(row.cost_variance_to_forecast),
    costVarianceToBaseline: num(row.cost_variance_to_baseline)
  }));

  try {
    const bridge = buildWaterfallBridge({ reforecastLines, varianceLines });
    return { readiness: 'ready', context: ctx, bridge, reconciliationError: null, pinnedSourceIssues: [] };
  } catch (error) {
    return { readiness: 'incomplete_inputs', context: ctx, bridge: null, reconciliationError: (error as Error).message, pinnedSourceIssues: [] };
  }
}
