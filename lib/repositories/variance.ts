import 'server-only';

import {
  buildVarianceLines,
  computeVarianceChecksum,
  summariseVariance,
  type ComparatorLine,
  type ActualsLineDraft,
  type VarianceLineDraft,
  type VarianceTotals
} from '../variance/variance-engine';
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

export function canReadVariance(context: UserContext): boolean {
  return hasPermission(context.roles, 'variance:read');
}
export function canCreateVariance(context: UserContext): boolean {
  return hasPermission(context.roles, 'variance:create');
}
export function canWriteVariance(context: UserContext): boolean {
  return hasPermission(context.roles, 'variance:write');
}
export function canLockVariance(context: UserContext): boolean {
  return hasPermission(context.roles, 'variance:lock');
}
export function canVoidVariance(context: UserContext): boolean {
  return hasPermission(context.roles, 'variance:void');
}

interface VarianceInputs {
  batch: JsonRecord;
  reforecast: JsonRecord;
  baseline: JsonRecord;
  actualLines: ActualsLineDraft[];
  forecastLines: ComparatorLine[];
  baselineLines: ComparatorLine[];
}

async function loadVarianceInputs(context: UserContext, actualsBatchId: string, reforecastId: string): Promise<VarianceInputs> {
  const supabase = await createClient();
  const orgId = context.organisationId;

  const { data: batch } = await supabase
    .from('actuals_batches').select('*').eq('organisation_id', orgId).eq('id', actualsBatchId).maybeSingle();
  if (!batch) throw new Error('Actuals batch not found');
  const batchRecord = batch as JsonRecord;
  if (String(batchRecord.status) !== 'posted') throw new Error('Variance can only be calculated from posted actuals');

  const { data: reforecast } = await supabase
    .from('reforecasts').select('*').eq('organisation_id', orgId).eq('id', reforecastId).maybeSingle();
  if (!reforecast) throw new Error('Reforecast not found');
  const reforecastRecord = reforecast as JsonRecord;
  if (!['locked', 'superseded'].includes(String(reforecastRecord.status))) {
    throw new Error('Variance must compare against a locked forecast version');
  }
  if (!reforecastRecord.lock_version_id || !reforecastRecord.checksum) {
    throw new Error('Variance comparator must carry a lock version and checksum');
  }
  if (String(reforecastRecord.budget_baseline_id) !== String(batchRecord.baseline_id)) {
    throw new Error('Actuals batch and forecast must belong to the same baseline context');
  }

  const { data: baseline } = await supabase
    .from('budget_baselines').select('*').eq('organisation_id', orgId).eq('id', String(batchRecord.baseline_id)).maybeSingle();
  if (!baseline) throw new Error('Budget baseline not found');

  const [actualLinesRes, forecastLinesRes, baselineLinesRes] = await Promise.all([
    supabase.from('actuals_lines').select('*').eq('organisation_id', orgId).eq('actuals_batch_id', actualsBatchId).order('period_number', { ascending: true }),
    supabase.from('reforecast_lines').select('*').eq('organisation_id', orgId).eq('reforecast_id', reforecastId).order('period_number', { ascending: true }),
    supabase.from('budget_baseline_lines').select('*').eq('organisation_id', orgId).eq('budget_baseline_id', String(batchRecord.baseline_id)).order('period_start', { ascending: true })
  ]);

  const actualLines: ActualsLineDraft[] = ((actualLinesRes.data ?? []) as JsonRecord[]).map((line) => ({
    planningPeriodId: String(line.planning_period_id),
    periodNumber: numberFrom(line.period_number),
    periodStart: String(line.period_start),
    periodEnd: String(line.period_end),
    actualCost: numberFrom(line.actual_cost),
    actualFte: numberFrom(line.actual_fte),
    actualWorkloadHours: numberFrom(line.actual_workload_hours),
    sourceRowReference: line.source_row_reference ? String(line.source_row_reference) : null
  }));

  const forecastLines: ComparatorLine[] = ((forecastLinesRes.data ?? []) as JsonRecord[]).map((line) => ({
    planningPeriodId: String(line.period_id),
    cost: numberFrom(line.forecast_budget_amount),
    fte: numberFrom(line.forecast_required_fte),
    workloadHours: numberFrom(line.forecast_workload_hours)
  }));

  const baselineLines: ComparatorLine[] = ((baselineLinesRes.data ?? []) as JsonRecord[]).map((line) => ({
    planningPeriodId: String(line.period_id),
    cost: numberFrom(line.budget_amount),
    fte: numberFrom(line.required_fte),
    workloadHours: numberFrom(line.workload_hours)
  }));

  return { batch: batchRecord, reforecast: reforecastRecord, baseline: baseline as JsonRecord, actualLines, forecastLines, baselineLines };
}

function linePayloads(lines: VarianceLineDraft[]): Json {
  return lines.map((line) => ({
    planning_period_id: line.planningPeriodId,
    period_number: line.periodNumber,
    period_start: line.periodStart,
    period_end: line.periodEnd,
    actual_cost: line.actualCost,
    forecast_cost: line.forecastCost,
    baseline_cost: line.baselineCost,
    cost_variance_to_forecast: line.costVarianceToForecast,
    cost_variance_to_forecast_pct: line.costVarianceToForecastPct,
    cost_variance_to_baseline: line.costVarianceToBaseline,
    cost_variance_to_baseline_pct: line.costVarianceToBaselinePct,
    actual_fte: line.actualFte,
    forecast_fte: line.forecastFte,
    baseline_fte: line.baselineFte,
    fte_variance_to_forecast: line.fteVarianceToForecast,
    fte_variance_to_baseline: line.fteVarianceToBaseline,
    actual_workload_hours: line.actualWorkloadHours,
    forecast_workload_hours: line.forecastWorkloadHours,
    baseline_workload_hours: line.baselineWorkloadHours,
    workload_variance_to_forecast: line.workloadVarianceToForecast,
    workload_variance_to_baseline: line.workloadVarianceToBaseline
  })) as Json;
}

export async function createVarianceReport(
  context: UserContext,
  actualsBatchId: string,
  reforecastId: string,
  reportName: string,
  reason: string
): Promise<string> {
  requirePermission(context.roles, 'variance:create');
  if (!reportName.trim()) throw new Error('Variance report name is required');

  const inputs = await loadVarianceInputs(context, actualsBatchId, reforecastId);
  const lines = buildVarianceLines({
    actualLines: inputs.actualLines,
    forecastLines: inputs.forecastLines,
    baselineLines: inputs.baselineLines
  });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('create_variance_report', {
    target_organisation_id: context.organisationId,
    target_actor_user_id: context.userId,
    report_payload: {
      actuals_batch_id: actualsBatchId,
      reforecast_id: reforecastId,
      report_name: reportName.trim(),
      baseline_checksum: inputs.baseline.checksum ?? null
    } as Json,
    line_payloads: linePayloads(lines),
    create_reason: reason || null
  });
  if (error) throw new Error(`Could not create variance report: ${error.message}`);
  return String((data as JsonRecord | null)?.id ?? '');
}

export async function recalculateVarianceReport(context: UserContext, reportId: string, reason: string): Promise<void> {
  requirePermission(context.roles, 'variance:write');
  const supabase = await createClient();
  const { data: report } = await supabase
    .from('variance_reports').select('*').eq('organisation_id', context.organisationId).eq('id', reportId).maybeSingle();
  if (!report) throw new Error('Variance report not found');
  const record = report as JsonRecord;
  if (String(record.status) !== 'draft') throw new Error('Only draft variance reports can be recalculated');

  // Recalculation reuses the SAME pinned actuals batch and forecast version.
  // Both sides are immutable, so the result is deterministic.
  const inputs = await loadVarianceInputs(context, String(record.actuals_batch_id), String(record.reforecast_id));
  const lines = buildVarianceLines({
    actualLines: inputs.actualLines,
    forecastLines: inputs.forecastLines,
    baselineLines: inputs.baselineLines
  });

  const admin = createAdminClient();
  const { error } = await admin.rpc('recalculate_variance_report', {
    target_organisation_id: context.organisationId,
    target_actor_user_id: context.userId,
    target_report_id: reportId,
    line_payloads: linePayloads(lines),
    recalculate_reason: reason || null
  });
  if (error) throw new Error(`Could not recalculate variance report: ${error.message}`);
}

export async function lockVarianceReport(context: UserContext, reportId: string, reason: string): Promise<void> {
  requirePermission(context.roles, 'variance:lock');
  const supabase = await createClient();
  const orgId = context.organisationId;
  const { data: report } = await supabase
    .from('variance_reports').select('*').eq('organisation_id', orgId).eq('id', reportId).maybeSingle();
  if (!report) throw new Error('Variance report not found');
  const record = report as JsonRecord;
  if (String(record.status) !== 'draft') throw new Error('Only draft variance reports can be locked');

  const { data: storedLines } = await supabase
    .from('variance_lines').select('*').eq('organisation_id', orgId).eq('variance_report_id', reportId).order('period_number', { ascending: true });

  const lines: VarianceLineDraft[] = ((storedLines ?? []) as JsonRecord[]).map((line) => ({
    planningPeriodId: String(line.planning_period_id),
    periodNumber: numberFrom(line.period_number),
    periodStart: String(line.period_start),
    periodEnd: String(line.period_end),
    actualCost: numberFrom(line.actual_cost),
    forecastCost: numberFrom(line.forecast_cost),
    baselineCost: numberFrom(line.baseline_cost),
    costVarianceToForecast: numberFrom(line.cost_variance_to_forecast),
    costVarianceToForecastPct: line.cost_variance_to_forecast_pct === null ? null : numberFrom(line.cost_variance_to_forecast_pct),
    costVarianceToBaseline: numberFrom(line.cost_variance_to_baseline),
    costVarianceToBaselinePct: line.cost_variance_to_baseline_pct === null ? null : numberFrom(line.cost_variance_to_baseline_pct),
    actualFte: numberFrom(line.actual_fte),
    forecastFte: numberFrom(line.forecast_fte),
    baselineFte: numberFrom(line.baseline_fte),
    fteVarianceToForecast: numberFrom(line.fte_variance_to_forecast),
    fteVarianceToBaseline: numberFrom(line.fte_variance_to_baseline),
    actualWorkloadHours: numberFrom(line.actual_workload_hours),
    forecastWorkloadHours: numberFrom(line.forecast_workload_hours),
    baselineWorkloadHours: numberFrom(line.baseline_workload_hours),
    workloadVarianceToForecast: numberFrom(line.workload_variance_to_forecast),
    workloadVarianceToBaseline: numberFrom(line.workload_variance_to_baseline)
  }));

  const checksum = computeVarianceChecksum(lines, {
    comparatorLockVersionId: String(record.comparator_lock_version_id),
    comparatorChecksum: String(record.comparator_checksum),
    actualsChecksum: String(record.actuals_checksum)
  });

  const admin = createAdminClient();
  const { error } = await admin.rpc('lock_variance_report', {
    target_organisation_id: orgId,
    target_actor_user_id: context.userId,
    target_report_id: reportId,
    lock_checksum: checksum,
    lock_reason: reason || null
  });
  if (error) throw new Error(`Could not lock variance report: ${error.message}`);
}

export async function voidVarianceReport(context: UserContext, reportId: string, reason: string): Promise<void> {
  requirePermission(context.roles, 'variance:void');
  const admin = createAdminClient();
  const { error } = await admin.rpc('void_variance_report', {
    target_organisation_id: context.organisationId,
    target_actor_user_id: context.userId,
    target_report_id: reportId,
    void_reason: reason || null
  });
  if (error) throw new Error(`Could not void variance report: ${error.message}`);
}

export interface VarianceDashboardData {
  plans: JsonRecord[];
  fiscalYears: JsonRecord[];
  postedBatches: JsonRecord[];
  lockedReforecasts: JsonRecord[];
  reports: JsonRecord[];
  totalsByReport: Map<string, VarianceTotals>;
}

export async function getVarianceDashboard(context: UserContext): Promise<VarianceDashboardData> {
  requirePermission(context.roles, 'variance:read');
  const supabase = await createClient();
  const orgId = context.organisationId;

  const [plansRes, fiscalYearsRes, batchesRes, reforecastsRes, reportsRes, linesRes] = await Promise.all([
    supabase.from('plans').select('*').eq('organisation_id', orgId).order('created_at', { ascending: false }),
    supabase.from('fiscal_years').select('*').eq('organisation_id', orgId).order('start_date', { ascending: false }),
    supabase.from('actuals_batches').select('*').eq('organisation_id', orgId).eq('status', 'posted').order('posted_at', { ascending: false }),
    supabase.from('reforecasts').select('*').eq('organisation_id', orgId).in('status', ['locked', 'superseded']).order('locked_at', { ascending: false }),
    supabase.from('variance_reports').select('*').eq('organisation_id', orgId).order('created_at', { ascending: false }),
    supabase.from('variance_lines').select('*').eq('organisation_id', orgId)
  ]);

  const allLines = (linesRes.data ?? []) as JsonRecord[];
  const totalsByReport = new Map<string, VarianceTotals>();
  for (const report of (reportsRes.data ?? []) as JsonRecord[]) {
    const reportLines = allLines
      .filter((line) => String(line.variance_report_id) === String(report.id))
      .map((line) => ({
        planningPeriodId: String(line.planning_period_id),
        periodNumber: numberFrom(line.period_number),
        periodStart: String(line.period_start),
        periodEnd: String(line.period_end),
        actualCost: numberFrom(line.actual_cost),
        forecastCost: numberFrom(line.forecast_cost),
        baselineCost: numberFrom(line.baseline_cost),
        costVarianceToForecast: numberFrom(line.cost_variance_to_forecast),
        costVarianceToForecastPct: null,
        costVarianceToBaseline: numberFrom(line.cost_variance_to_baseline),
        costVarianceToBaselinePct: null,
        actualFte: numberFrom(line.actual_fte),
        forecastFte: numberFrom(line.forecast_fte),
        baselineFte: numberFrom(line.baseline_fte),
        fteVarianceToForecast: numberFrom(line.fte_variance_to_forecast),
        fteVarianceToBaseline: numberFrom(line.fte_variance_to_baseline),
        actualWorkloadHours: numberFrom(line.actual_workload_hours),
        forecastWorkloadHours: numberFrom(line.forecast_workload_hours),
        baselineWorkloadHours: numberFrom(line.baseline_workload_hours),
        workloadVarianceToForecast: numberFrom(line.workload_variance_to_forecast),
        workloadVarianceToBaseline: numberFrom(line.workload_variance_to_baseline)
      }));
    totalsByReport.set(String(report.id), summariseVariance(reportLines));
  }

  return {
    plans: (plansRes.data ?? []) as JsonRecord[],
    fiscalYears: (fiscalYearsRes.data ?? []) as JsonRecord[],
    postedBatches: (batchesRes.data ?? []) as JsonRecord[],
    lockedReforecasts: (reforecastsRes.data ?? []) as JsonRecord[],
    reports: (reportsRes.data ?? []) as JsonRecord[],
    totalsByReport
  };
}

export interface VarianceDetailData {
  report: JsonRecord | null;
  lines: JsonRecord[];
  totals: VarianceTotals | null;
  batch: JsonRecord | null;
  reforecast: JsonRecord | null;
  baseline: JsonRecord | null;
  auditEvents: JsonRecord[];
  supersededBy: JsonRecord | null;
}

export async function getVarianceDetail(context: UserContext, reportId: string): Promise<VarianceDetailData> {
  requirePermission(context.roles, 'variance:read');
  const supabase = await createClient();
  const orgId = context.organisationId;

  const { data: report } = await supabase
    .from('variance_reports').select('*').eq('organisation_id', orgId).eq('id', reportId).maybeSingle();
  if (!report) {
    return { report: null, lines: [], totals: null, batch: null, reforecast: null, baseline: null, auditEvents: [], supersededBy: null };
  }
  const record = report as JsonRecord;

  const [linesRes, batchRes, reforecastRes, baselineRes, auditRes] = await Promise.all([
    supabase.from('variance_lines').select('*').eq('organisation_id', orgId).eq('variance_report_id', reportId).order('period_number', { ascending: true }),
    supabase.from('actuals_batches').select('*').eq('organisation_id', orgId).eq('id', String(record.actuals_batch_id)).maybeSingle(),
    supabase.from('reforecasts').select('*').eq('organisation_id', orgId).eq('id', String(record.reforecast_id)).maybeSingle(),
    supabase.from('budget_baselines').select('*').eq('organisation_id', orgId).eq('id', String(record.baseline_id)).maybeSingle(),
    supabase.from('audit_events').select('*').eq('organisation_id', orgId).eq('entity_type', 'variance_report').eq('entity_id', reportId).order('created_at', { ascending: false }).limit(50)
  ]);

  const lines = (linesRes.data ?? []) as JsonRecord[];
  const totals = summariseVariance(lines.map((line) => ({
    planningPeriodId: String(line.planning_period_id),
    periodNumber: numberFrom(line.period_number),
    periodStart: String(line.period_start),
    periodEnd: String(line.period_end),
    actualCost: numberFrom(line.actual_cost),
    forecastCost: numberFrom(line.forecast_cost),
    baselineCost: numberFrom(line.baseline_cost),
    costVarianceToForecast: numberFrom(line.cost_variance_to_forecast),
    costVarianceToForecastPct: null,
    costVarianceToBaseline: numberFrom(line.cost_variance_to_baseline),
    costVarianceToBaselinePct: null,
    actualFte: numberFrom(line.actual_fte),
    forecastFte: numberFrom(line.forecast_fte),
    baselineFte: numberFrom(line.baseline_fte),
    fteVarianceToForecast: numberFrom(line.fte_variance_to_forecast),
    fteVarianceToBaseline: numberFrom(line.fte_variance_to_baseline),
    actualWorkloadHours: numberFrom(line.actual_workload_hours),
    forecastWorkloadHours: numberFrom(line.forecast_workload_hours),
    baselineWorkloadHours: numberFrom(line.baseline_workload_hours),
    workloadVarianceToForecast: numberFrom(line.workload_variance_to_forecast),
    workloadVarianceToBaseline: numberFrom(line.workload_variance_to_baseline)
  })));

  async function relatedReport(id: unknown): Promise<JsonRecord | null> {
    if (!id) return null;
    const { data } = await supabase.from('variance_reports').select('*').eq('organisation_id', orgId).eq('id', String(id)).maybeSingle();
    return (data as JsonRecord) ?? null;
  }

  return {
    report: record,
    lines,
    totals,
    batch: (batchRes.data as JsonRecord) ?? null,
    reforecast: (reforecastRes.data as JsonRecord) ?? null,
    baseline: (baselineRes.data as JsonRecord) ?? null,
    auditEvents: (auditRes.data ?? []) as JsonRecord[],
    supersededBy: await relatedReport(record.superseded_by_variance_id)
  };
}
