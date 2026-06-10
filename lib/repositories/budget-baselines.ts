import 'server-only';

import { insertAuditEvent } from '../audit/audit-service';
import {
  annualsFromLayer1Handoff,
  buildBudgetBaselineSnapshot,
  checkBaselineReconciliation,
  checksumBudgetBaselineSnapshot,
  createStraightLineBaselineLines,
  type BudgetBaselineAnnuals,
  type BudgetPlanningPeriod
} from '../baseline/baseline-engine';
import { hasPermission, requirePermission } from '../permissions/permissions';
import { createAdminClient } from '../supabase/admin';
import { createClient } from '../supabase/server';
import type { Json } from '../../types/database';
import type { UserContext } from '../../types/models';

export interface BaselineDashboardData {
  plans: Record<string, unknown>[];
  fiscalYears: Record<string, unknown>[];
  readyHandoffs: Record<string, unknown>[];
  baselines: Record<string, unknown>[];
  snapshots: Record<string, unknown>[];
}

export interface BaselineDetailData {
  baseline: Record<string, unknown> | null;
  lines: Record<string, unknown>[];
  snapshot: Record<string, unknown> | null;
  sourceHandoff: Record<string, unknown> | null;
  auditEvents: Record<string, unknown>[];
  reconciliation: ReturnType<typeof checkBaselineReconciliation> | null;
}

function nullableString(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function numberFrom(value: unknown, fallback = 0): number {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toJson(value: unknown): Json {
  return value as Json;
}

function mapPeriod(row: Record<string, unknown>): BudgetPlanningPeriod {
  return {
    id: String(row.id),
    periodNumber: numberFrom(row.period_number),
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    periodLabel: String(row.period_label ?? row.period_start)
  };
}

function lineDraftToPayload(line: ReturnType<typeof createStraightLineBaselineLines>[number]) {
  return {
    period_id: line.periodId,
    period_start: line.periodStart,
    period_end: line.periodEnd,
    workload_hours: line.workloadHours,
    required_fte: line.requiredFte,
    supply_gap_fte: line.supplyGapFte,
    labour_cost: line.labourCost,
    budget_amount: line.budgetAmount,
    phasing_method: line.phasingMethod,
    source_category: line.sourceCategory,
    notes: line.notes
  };
}

async function listPeriodsForFiscalYear(context: UserContext, fiscalYearId: string): Promise<BudgetPlanningPeriod[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('planning_periods')
    .select('id, period_number, period_start, period_end, period_label')
    .eq('organisation_id', context.organisationId)
    .eq('fiscal_year_id', fiscalYearId)
    .order('period_number', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => mapPeriod(row));
}

export async function getBudgetBaselineDashboard(context: UserContext): Promise<BaselineDashboardData> {
  requirePermission(context.roles, 'baseline:read');
  const supabase = await createClient();
  const [plans, fiscalYears, readyHandoffs, baselines, snapshots] = await Promise.all([
    supabase.from('plans').select('id, plan_name, status').eq('organisation_id', context.organisationId).order('created_at', { ascending: false }),
    supabase.from('fiscal_years').select('id, plan_id, fiscal_year_label, start_date, end_date, status').eq('organisation_id', context.organisationId).order('start_date', { ascending: false }),
    supabase.from('layer1_handoff_objects').select('*').eq('organisation_id', context.organisationId).eq('handoff_status', 'ready_for_layer2').order('created_at', { ascending: false }),
    supabase.from('budget_baselines').select('*').eq('organisation_id', context.organisationId).order('created_at', { ascending: false }),
    supabase.from('budget_baseline_snapshots').select('*').eq('organisation_id', context.organisationId).order('locked_at', { ascending: false }).limit(10)
  ]);
  for (const result of [plans, fiscalYears, readyHandoffs, baselines, snapshots]) {
    if (result.error) throw result.error;
  }
  return {
    plans: plans.data ?? [],
    fiscalYears: fiscalYears.data ?? [],
    readyHandoffs: readyHandoffs.data ?? [],
    baselines: baselines.data ?? [],
    snapshots: snapshots.data ?? []
  };
}

async function createBaselineDraftWithLines(context: UserContext, baselinePayload: Record<string, unknown>, lines: Record<string, unknown>[], reason: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('create_budget_baseline_draft', {
    target_organisation_id: context.organisationId,
    target_actor_user_id: context.userId,
    baseline_payload: toJson(baselinePayload),
    line_payloads: toJson(lines),
    create_reason: reason
  });
  if (error) throw error;
  return data;
}

export async function createBudgetBaselineFromLayer1Handoff(context: UserContext, input: Record<string, unknown>) {
  requirePermission(context.roles, 'baseline:create');
  const handoffId = String(input.handoff_id ?? '');
  const baselineName = nullableString(input.baseline_name) ?? 'Layer 1 imported budget baseline';
  if (!handoffId) throw new Error('Layer 1 handoff is required');

  const admin = createAdminClient();
  const { data: handoff, error: handoffError } = await admin
    .from('layer1_handoff_objects')
    .select('*')
    .eq('organisation_id', context.organisationId)
    .eq('id', handoffId)
    .single();
  if (handoffError) throw handoffError;
  if (String(handoff.handoff_status) !== 'ready_for_layer2') throw new Error('Only ready_for_layer2 handoffs can create a budget baseline');

  const fiscalYearId = String(handoff.fiscal_year_id ?? input.fiscal_year_id ?? '');
  if (!fiscalYearId) throw new Error('Fiscal year is required to create a budget baseline');
  const periods = await listPeriodsForFiscalYear(context, fiscalYearId);
  if (periods.length !== 12) throw new Error('Budget baseline requires 12 planning periods');

  const annuals = annualsFromLayer1Handoff(handoff);
  const lines = createStraightLineBaselineLines({ periods, annuals, sourceCategory: 'layer1_handoff', phasingMethod: 'imported_from_layer1' }).map(lineDraftToPayload);
  const labourBudget = asRecord(handoff.labour_budget_outputs_json);
  const baselinePayload = {
    organisation_id: context.organisationId,
    plan_id: String(handoff.plan_id),
    fiscal_year_id: fiscalYearId,
    baseline_name: baselineName,
    baseline_type: 'annual_labour_opex',
    source_type: 'layer1_handoff',
    source_layer1_handoff_id: handoffId,
    source_layer1_version_lock_id: String(handoff.version_lock_id ?? ''),
    annual_budget_amount: annuals.annualBudgetAmount,
    annual_required_fte: annuals.annualRequiredFte,
    annual_workload_hours: annuals.annualWorkloadHours,
    annual_labour_cost: annuals.annualLabourCost,
    annual_supply_gap_fte: annuals.annualSupplyGapFte,
    source_quality_score: handoff.source_quality_score,
    confidence_score: handoff.confidence_score,
    key_assumptions_json: handoff.key_assumptions_json ?? {},
    risk_summary_json: handoff.risk_summary_json ?? handoff.unresolved_risks_json ?? [],
    scenario_summary_json: handoff.scenario_outputs_json ?? [],
    annualisation_note: handoff.annualisation_note ?? labourBudget.annualisationNote ?? null,
    notes: nullableString(input.notes)
  };
  return createBaselineDraftWithLines(context, baselinePayload, lines, 'Budget baseline created from approved Layer 1 handoff');
}

export async function createManualBudgetBaseline(context: UserContext, input: Record<string, unknown>) {
  requirePermission(context.roles, 'baseline:create');
  const planId = String(input.plan_id ?? '');
  const fiscalYearId = String(input.fiscal_year_id ?? '');
  const baselineName = nullableString(input.baseline_name);
  if (!planId) throw new Error('Plan is required');
  if (!fiscalYearId) throw new Error('Fiscal year is required');
  if (!baselineName) throw new Error('Baseline name is required');
  const annuals: BudgetBaselineAnnuals = {
    annualBudgetAmount: numberFrom(input.annual_budget_amount),
    annualRequiredFte: numberFrom(input.annual_required_fte),
    annualWorkloadHours: numberFrom(input.annual_workload_hours),
    annualLabourCost: numberFrom(input.annual_labour_cost, numberFrom(input.annual_budget_amount)),
    annualSupplyGapFte: numberFrom(input.annual_supply_gap_fte)
  };
  const periods = await listPeriodsForFiscalYear(context, fiscalYearId);
  if (periods.length !== 12) throw new Error('Budget baseline requires 12 planning periods');
  const lines = createStraightLineBaselineLines({ periods, annuals, sourceCategory: 'manual', phasingMethod: 'straight_line', notes: 'Manual straight-line phasing generated at baseline creation' }).map(lineDraftToPayload);
  const baselinePayload = {
    organisation_id: context.organisationId,
    plan_id: planId,
    fiscal_year_id: fiscalYearId,
    baseline_name: baselineName,
    baseline_type: 'annual_labour_opex',
    source_type: 'manual',
    source_layer1_handoff_id: null,
    source_layer1_version_lock_id: null,
    annual_budget_amount: annuals.annualBudgetAmount,
    annual_required_fte: annuals.annualRequiredFte,
    annual_workload_hours: annuals.annualWorkloadHours,
    annual_labour_cost: annuals.annualLabourCost,
    annual_supply_gap_fte: annuals.annualSupplyGapFte,
    key_assumptions_json: {},
    risk_summary_json: [],
    scenario_summary_json: [],
    annualisation_note: 'Manual baseline. Annual labour cost and budget values are user-entered and phased across the fiscal year.',
    notes: nullableString(input.notes)
  };
  return createBaselineDraftWithLines(context, baselinePayload, lines, 'Manual budget baseline created');
}

export async function getBudgetBaselineDetail(context: UserContext, baselineId: string): Promise<BaselineDetailData> {
  requirePermission(context.roles, 'baseline:read');
  if (!baselineId) return { baseline: null, lines: [], snapshot: null, sourceHandoff: null, auditEvents: [], reconciliation: null };
  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: baseline, error: baselineError } = await supabase
    .from('budget_baselines')
    .select('*')
    .eq('organisation_id', context.organisationId)
    .eq('id', baselineId)
    .single();
  if (baselineError) throw baselineError;

  const [lines, snapshots, auditEvents, sourceHandoff] = await Promise.all([
    supabase.from('budget_baseline_lines').select('*').eq('organisation_id', context.organisationId).eq('budget_baseline_id', baselineId).order('period_start', { ascending: true }),
    supabase.from('budget_baseline_snapshots').select('*').eq('organisation_id', context.organisationId).eq('budget_baseline_id', baselineId).order('locked_at', { ascending: false }).limit(1),
    admin.from('audit_events').select('*').eq('organisation_id', context.organisationId).eq('plan_id', String(baseline.plan_id)).eq('entity_id', baselineId).like('event_type', 'budget_baseline.%').order('created_at', { ascending: false }).limit(20),
    baseline.source_layer1_handoff_id
      ? supabase.from('layer1_handoff_objects').select('*').eq('organisation_id', context.organisationId).eq('id', String(baseline.source_layer1_handoff_id)).maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);
  for (const result of [lines, snapshots, auditEvents, sourceHandoff]) {
    if (result.error) throw result.error;
  }
  const lineRows = lines.data ?? [];
  const reconciliation = checkBaselineReconciliation({
    lines: lineRows.map((line) => ({ budgetAmount: numberFrom(line.budget_amount), labourCost: numberFrom(line.labour_cost), workloadHours: numberFrom(line.workload_hours) })),
    annualBudgetAmount: numberFrom(baseline.annual_budget_amount),
    annualLabourCost: numberFrom(baseline.annual_labour_cost),
    annualWorkloadHours: numberFrom(baseline.annual_workload_hours)
  });
  return {
    baseline,
    lines: lineRows,
    snapshot: snapshots.data?.[0] ?? null,
    sourceHandoff: sourceHandoff.data ?? null,
    auditEvents: auditEvents.data ?? [],
    reconciliation
  };
}

export async function updateBudgetBaselinePhasing(context: UserContext, input: {
  baselineId: string;
  lineIds: string[];
  workloadHours: string[];
  requiredFte: string[];
  supplyGapFte: string[];
  labourCost: string[];
  budgetAmount: string[];
  notes?: string | null;
}) {
  requirePermission(context.roles, 'baseline:write');
  const detail = await getBudgetBaselineDetail(context, input.baselineId);
  if (!detail.baseline) throw new Error('Budget baseline not found');
  if (String(detail.baseline.status) === 'locked' || detail.baseline.is_immutable === true) throw new Error('Locked budget baseline lines cannot be edited');
  const admin = createAdminClient();
  for (let index = 0; index < input.lineIds.length; index += 1) {
    const lineId = input.lineIds[index];
    const payload = {
      workload_hours: numberFrom(input.workloadHours[index]),
      required_fte: numberFrom(input.requiredFte[index]),
      supply_gap_fte: numberFrom(input.supplyGapFte[index]),
      labour_cost: numberFrom(input.labourCost[index]),
      budget_amount: numberFrom(input.budgetAmount[index]),
      phasing_method: 'custom_manual',
      notes: nullableString(input.notes)
    };
    const { error } = await admin
      .from('budget_baseline_lines')
      .update(payload)
      .eq('organisation_id', context.organisationId)
      .eq('budget_baseline_id', input.baselineId)
      .eq('id', lineId);
    if (error) throw error;
  }
  await insertAuditEvent({
    organisationId: context.organisationId,
    actorUserId: context.userId,
    eventType: 'budget_baseline.phasing_edited',
    entityType: 'budget_baseline',
    entityId: input.baselineId,
    planId: String(detail.baseline.plan_id),
    fiscalYearId: String(detail.baseline.fiscal_year_id),
    newValue: { line_count: input.lineIds.length, phasing_method: 'custom_manual' },
    reason: input.notes ?? 'Budget baseline monthly phasing edited'
  });
}

export async function markBudgetBaselineReviewed(context: UserContext, baselineId: string, notes?: string | null) {
  requirePermission(context.roles, 'baseline:review');
  const detail = await getBudgetBaselineDetail(context, baselineId);
  if (!detail.baseline) throw new Error('Budget baseline not found');
  if (!['draft', 'reviewed'].includes(String(detail.baseline.status))) throw new Error('Only draft baselines can be marked reviewed');
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('budget_baselines')
    .update({ status: 'reviewed' })
    .eq('organisation_id', context.organisationId)
    .eq('id', baselineId)
    .select('*')
    .single();
  if (error) throw error;
  await insertAuditEvent({
    organisationId: context.organisationId,
    actorUserId: context.userId,
    eventType: 'budget_baseline.reviewed',
    entityType: 'budget_baseline',
    entityId: baselineId,
    planId: String(detail.baseline.plan_id),
    fiscalYearId: String(detail.baseline.fiscal_year_id),
    oldValue: { status: detail.baseline.status },
    newValue: { status: 'reviewed' },
    reason: notes ?? 'Budget baseline reviewed'
  });
  return data;
}

export async function lockBudgetBaseline(context: UserContext, baselineId: string, notes?: string | null) {
  requirePermission(context.roles, 'baseline:lock');
  const detail = await getBudgetBaselineDetail(context, baselineId);
  if (!detail.baseline) throw new Error('Budget baseline not found');
  if (!detail.reconciliation?.reconciles) throw new Error('Budget baseline does not reconcile to annual totals');
  const lockedAt = new Date().toISOString();
  const snapshot = buildBudgetBaselineSnapshot({ baseline: detail.baseline, lines: detail.lines, sourceHandoff: detail.sourceHandoff, lockedBy: context.userId, lockedAt });
  const checksum = checksumBudgetBaselineSnapshot(snapshot);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('lock_budget_baseline', {
    target_organisation_id: context.organisationId,
    target_plan_id: String(detail.baseline.plan_id),
    target_fiscal_year_id: String(detail.baseline.fiscal_year_id),
    target_budget_baseline_id: baselineId,
    target_actor_user_id: context.userId,
    snapshot_payload: toJson(snapshot),
    target_checksum: checksum,
    lock_reason: notes ?? 'Budget baseline locked'
  });
  if (error) throw error;
  return data;
}

export function canCreateBaseline(context: UserContext): boolean {
  return hasPermission(context.roles, 'baseline:create');
}

export function canReviewBaseline(context: UserContext): boolean {
  return hasPermission(context.roles, 'baseline:review');
}

export function canLockBaseline(context: UserContext): boolean {
  return hasPermission(context.roles, 'baseline:lock');
}
