import 'server-only';

import {
  computeActualsChecksum,
  mapCsvRowsToActualsLines,
  validateActualsLines,
  type ActualsLineDraft,
  type PlanningPeriodRef
} from '../variance/variance-engine';
import { round2 } from '../drivers/driver-engine';
import { hasPermission, requirePermission } from '../permissions/permissions';
import { createAdminClient } from '../supabase/admin';
import { createClient } from '../supabase/server';
import { maybe, rows } from './read-result';
import type { Json } from '../../types/database';
import type { UserContext } from '../../types/models';

type JsonRecord = Record<string, unknown>;

function numberFrom(value: unknown, fallback = 0): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function canReadActuals(context: UserContext): boolean {
  return hasPermission(context.roles, 'actuals:read');
}
export function canCreateActuals(context: UserContext): boolean {
  return hasPermission(context.roles, 'actuals:create');
}
export function canWriteActuals(context: UserContext): boolean {
  return hasPermission(context.roles, 'actuals:write');
}
export function canValidateActuals(context: UserContext): boolean {
  return hasPermission(context.roles, 'actuals:validate');
}
export function canPostActuals(context: UserContext): boolean {
  return hasPermission(context.roles, 'actuals:post');
}
export function canSupersedeActuals(context: UserContext): boolean {
  return hasPermission(context.roles, 'actuals:supersede');
}
export function canVoidActuals(context: UserContext): boolean {
  return hasPermission(context.roles, 'actuals:void');
}

export async function getHorizonPeriods(context: UserContext, fiscalYearId: string): Promise<PlanningPeriodRef[]> {
  const supabase = await createClient();
  const periodsRes = await supabase
    .from('planning_periods')
    .select('*')
    .eq('organisation_id', context.organisationId)
    .eq('fiscal_year_id', fiscalYearId)
    .order('period_number', { ascending: true });
  return rows<JsonRecord>('the planning periods', periodsRes as never).map((period) => ({
    id: String(period.id),
    periodNumber: numberFrom(period.period_number),
    periodStart: String(period.period_start),
    periodEnd: String(period.period_end),
    periodLabel: String(period.period_label ?? period.period_start)
  }));
}

export interface ManualActualsRow {
  planningPeriodId: string;
  actualCost: number;
  actualFte: number;
  actualWorkloadHours: number;
}

function manualRowsToLines(periods: PlanningPeriodRef[], rows: ManualActualsRow[]): ActualsLineDraft[] {
  const periodById = new Map(periods.map((period) => [period.id, period]));
  return rows.map((row, index) => {
    const period = periodById.get(row.planningPeriodId);
    return {
      planningPeriodId: row.planningPeriodId,
      periodNumber: period?.periodNumber ?? -1,
      periodStart: period?.periodStart ?? '1970-01-01',
      periodEnd: period?.periodEnd ?? '1970-01-01',
      actualCost: Number.isFinite(row.actualCost) ? round2(row.actualCost) : row.actualCost,
      actualFte: Number.isFinite(row.actualFte) ? round2(row.actualFte) : row.actualFte,
      actualWorkloadHours: Number.isFinite(row.actualWorkloadHours) ? round2(row.actualWorkloadHours) : row.actualWorkloadHours,
      sourceRowReference: `manual row ${index + 1}`
    };
  });
}

function linePayloads(lines: ActualsLineDraft[]): Json {
  return lines.map((line) => ({
    planning_period_id: line.planningPeriodId,
    period_number: line.periodNumber,
    period_start: line.periodStart,
    period_end: line.periodEnd,
    actual_cost: line.actualCost,
    actual_fte: line.actualFte,
    actual_workload_hours: line.actualWorkloadHours,
    source_row_reference: line.sourceRowReference
  })) as Json;
}

async function resolveLines(
  context: UserContext,
  fiscalYearId: string,
  input: { sourceType: 'manual'; rows: ManualActualsRow[] } | { sourceType: 'csv'; csvText: string }
): Promise<{ lines: ActualsLineDraft[]; checksum: string }> {
  const periods = await getHorizonPeriods(context, fiscalYearId);
  let lines: ActualsLineDraft[];
  if (input.sourceType === 'csv') {
    const mapped = mapCsvRowsToActualsLines({ horizonPeriods: periods, csvText: input.csvText });
    if (mapped.issues.length > 0) {
      throw new Error(`Actuals rejected: ${mapped.issues.map((issue) => `${issue.rowReference} — ${issue.message}`).join('; ')}`);
    }
    lines = mapped.lines;
  } else {
    lines = manualRowsToLines(periods, input.rows);
    const issues = validateActualsLines({ horizonPeriods: periods, lines });
    if (issues.length > 0) {
      throw new Error(`Actuals rejected: ${issues.map((issue) => `${issue.rowReference} — ${issue.message}`).join('; ')}`);
    }
  }
  return { lines, checksum: computeActualsChecksum(lines) };
}

export async function createDraftActualsBatch(
  context: UserContext,
  baselineId: string,
  reforecastId: string | null,
  batchName: string,
  input: { sourceType: 'manual'; rows: ManualActualsRow[] } | { sourceType: 'csv'; csvText: string },
  reason: string
): Promise<string> {
  requirePermission(context.roles, 'actuals:create');
  if (!batchName.trim()) throw new Error('Actuals batch name is required');

  const supabase = await createClient();
  const { data: baseline } = await supabase
    .from('budget_baselines')
    .select('*')
    .eq('organisation_id', context.organisationId)
    .eq('id', baselineId)
    .maybeSingle();
  if (!baseline) throw new Error('Budget baseline not found');
  const baselineRecord = baseline as JsonRecord;
  if (String(baselineRecord.status) !== 'locked') throw new Error('Actuals can only be loaded against a locked budget baseline');

  // UAT hardening: a recorded forecast context must belong to the selected
  // baseline. The database RPC enforces this independently; checking here too
  // gives the user a clear error before any write is attempted.
  if (reforecastId) {
    const { data: contextReforecast } = await supabase
      .from('reforecasts')
      .select('id, budget_baseline_id, plan_id, fiscal_year_id, status')
      .eq('organisation_id', context.organisationId)
      .eq('id', reforecastId)
      .maybeSingle();
    const contextRecord = (contextReforecast ?? null) as JsonRecord | null;
    if (!contextRecord) throw new Error('Forecast context not found');
    if (String(contextRecord.budget_baseline_id) !== baselineId
      || String(contextRecord.plan_id) !== String(baselineRecord.plan_id)
      || String(contextRecord.fiscal_year_id) !== String(baselineRecord.fiscal_year_id)) {
      throw new Error('Forecast context must belong to the same baseline, plan and fiscal year as the actuals batch');
    }
    if (!['locked', 'superseded'].includes(String(contextRecord.status))) {
      throw new Error('Forecast context must be a locked forecast version');
    }
  }

  const { lines, checksum } = await resolveLines(context, String(baselineRecord.fiscal_year_id), input);

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('create_actuals_batch', {
    target_organisation_id: context.organisationId,
    target_actor_user_id: context.userId,
    batch_payload: {
      baseline_id: baselineId,
      reforecast_id: reforecastId ?? '',
      batch_name: batchName.trim(),
      source_type: input.sourceType,
      checksum
    } as Json,
    line_payloads: linePayloads(lines),
    create_reason: reason || null
  });
  if (error) throw new Error(`Could not create actuals batch: ${error.message}`);
  return String((data as JsonRecord | null)?.id ?? '');
}

export async function updateDraftActualsBatch(
  context: UserContext,
  batchId: string,
  input: { sourceType: 'manual'; rows: ManualActualsRow[] } | { sourceType: 'csv'; csvText: string },
  reason: string
): Promise<void> {
  requirePermission(context.roles, 'actuals:write');
  const supabase = await createClient();
  const { data: batch } = await supabase
    .from('actuals_batches')
    .select('*')
    .eq('organisation_id', context.organisationId)
    .eq('id', batchId)
    .maybeSingle();
  if (!batch) throw new Error('Actuals batch not found');
  const record = batch as JsonRecord;
  if (String(record.status) !== 'draft') throw new Error('Only draft actuals batches can be edited');

  const { lines, checksum } = await resolveLines(context, String(record.fiscal_year_id), input);

  const admin = createAdminClient();
  const { error } = await admin.rpc('update_actuals_batch_draft', {
    target_organisation_id: context.organisationId,
    target_actor_user_id: context.userId,
    target_batch_id: batchId,
    batch_payload: { checksum } as Json,
    line_payloads: linePayloads(lines),
    update_reason: reason || null
  });
  if (error) throw new Error(`Could not update actuals batch: ${error.message}`);
}

const actualsTransitionPermission: Record<string, Parameters<typeof requirePermission>[1]> = {
  validated: 'actuals:validate',
  draft: 'actuals:validate',
  posted: 'actuals:post',
  voided: 'actuals:void'
};

export async function transitionActualsBatchStatus(context: UserContext, batchId: string, nextStatus: string, reason: string): Promise<void> {
  const permission = actualsTransitionPermission[nextStatus];
  if (!permission) throw new Error(`Unknown actuals transition: ${nextStatus}`);
  requirePermission(context.roles, permission);

  const admin = createAdminClient();
  const { error } = await admin.rpc('transition_actuals_batch_status', {
    target_organisation_id: context.organisationId,
    target_actor_user_id: context.userId,
    target_batch_id: batchId,
    next_status: nextStatus,
    transition_reason: reason || null
  });
  if (error) throw new Error(`Actuals transition failed: ${error.message}`);
}

export async function supersedeActualsBatch(
  context: UserContext,
  batchId: string,
  batchName: string,
  input: { sourceType: 'manual'; rows: ManualActualsRow[] } | { sourceType: 'csv'; csvText: string },
  reason: string
): Promise<string> {
  requirePermission(context.roles, 'actuals:supersede');
  const supabase = await createClient();
  const { data: batch } = await supabase
    .from('actuals_batches')
    .select('*')
    .eq('organisation_id', context.organisationId)
    .eq('id', batchId)
    .maybeSingle();
  if (!batch) throw new Error('Actuals batch not found');
  const record = batch as JsonRecord;
  if (String(record.status) !== 'posted') throw new Error('Only posted actuals batches can be corrected by supersession');

  const { lines, checksum } = await resolveLines(context, String(record.fiscal_year_id), input);

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('supersede_actuals_batch', {
    target_organisation_id: context.organisationId,
    target_actor_user_id: context.userId,
    target_batch_id: batchId,
    replacement_payload: { batch_name: batchName.trim() || null, source_type: input.sourceType, checksum } as Json,
    replacement_lines: linePayloads(lines),
    supersede_reason: reason || null
  });
  if (error) throw new Error(`Could not supersede actuals batch: ${error.message}`);
  return String((data as JsonRecord | null)?.id ?? '');
}

export interface ActualsDashboardData {
  plans: JsonRecord[];
  fiscalYears: JsonRecord[];
  lockedBaselines: JsonRecord[];
  lockedReforecasts: JsonRecord[];
  batches: JsonRecord[];
  latestPostedByBaseline: Map<string, JsonRecord>;
}

export async function getActualsDashboard(context: UserContext): Promise<ActualsDashboardData> {
  requirePermission(context.roles, 'actuals:read');
  const supabase = await createClient();
  const orgId = context.organisationId;

  const [plansRes, fiscalYearsRes, baselinesRes, reforecastsRes, batchesRes] = await Promise.all([
    supabase.from('plans').select('*').eq('organisation_id', orgId).order('created_at', { ascending: false }),
    supabase.from('fiscal_years').select('*').eq('organisation_id', orgId).order('start_date', { ascending: false }),
    supabase.from('budget_baselines').select('*').eq('organisation_id', orgId).eq('status', 'locked').order('locked_at', { ascending: false }),
    supabase.from('reforecasts').select('*').eq('organisation_id', orgId).in('status', ['locked', 'superseded']).order('locked_at', { ascending: false }),
    supabase.from('actuals_batches').select('*').eq('organisation_id', orgId).order('created_at', { ascending: false })
  ]);

  const batches = rows<JsonRecord>('the actuals register', batchesRes as never);
  const latestPostedByBaseline = new Map<string, JsonRecord>();
  for (const batch of batches) {
    if (String(batch.status) !== 'posted') continue;
    const key = String(batch.baseline_id);
    const existing = latestPostedByBaseline.get(key);
    if (!existing || numberFrom(batch.version_number) > numberFrom(existing.version_number)) {
      latestPostedByBaseline.set(key, batch);
    }
  }

  return {
    plans: rows<JsonRecord>('plans', plansRes as never),
    fiscalYears: rows<JsonRecord>('fiscal years', fiscalYearsRes as never),
    lockedBaselines: rows<JsonRecord>('locked baselines', baselinesRes as never),
    lockedReforecasts: rows<JsonRecord>('locked forecasts', reforecastsRes as never),
    batches,
    latestPostedByBaseline
  };
}

export interface ActualsBatchDetailData {
  batch: JsonRecord | null;
  lines: JsonRecord[];
  baseline: JsonRecord | null;
  periods: PlanningPeriodRef[];
  auditEvents: JsonRecord[];
  supersedes: JsonRecord | null;
  supersededBy: JsonRecord | null;
}

export async function getActualsBatchDetail(context: UserContext, batchId: string): Promise<ActualsBatchDetailData> {
  requirePermission(context.roles, 'actuals:read');
  const supabase = await createClient();
  const orgId = context.organisationId;

  const batchRes = await supabase
    .from('actuals_batches')
    .select('*')
    .eq('organisation_id', orgId)
    .eq('id', batchId)
    .maybeSingle();

  const batch = maybe<JsonRecord>('this actuals batch', batchRes as never);
  if (!batch) {
    return { batch: null, lines: [], baseline: null, periods: [], auditEvents: [], supersedes: null, supersededBy: null };
  }
  const record = batch;

  const [linesRes, baselineRes, auditRes, periods] = await Promise.all([
    supabase.from('actuals_lines').select('*').eq('organisation_id', orgId).eq('actuals_batch_id', batchId).order('period_number', { ascending: true }),
    supabase.from('budget_baselines').select('*').eq('organisation_id', orgId).eq('id', String(record.baseline_id)).maybeSingle(),
    supabase.from('audit_events').select('*').eq('organisation_id', orgId).eq('entity_type', 'actuals_batch').eq('entity_id', batchId).order('created_at', { ascending: false }).limit(50),
    getHorizonPeriods(context, String(record.fiscal_year_id))
  ]);

  async function related(id: unknown): Promise<JsonRecord | null> {
    if (!id) return null;
    const { data } = await supabase.from('actuals_batches').select('*').eq('organisation_id', orgId).eq('id', String(id)).maybeSingle();
    return (data as JsonRecord) ?? null;
  }

  return {
    batch: record,
    lines: rows<JsonRecord>('the actuals rows', linesRes as never),
    baseline: maybe<JsonRecord>('the baseline', baselineRes as never),
    periods,
    auditEvents: rows<JsonRecord>('the actuals audit trail', auditRes as never),
    supersedes: await related(record.supersedes_batch_id),
    supersededBy: await related(record.superseded_by_batch_id)
  };
}
