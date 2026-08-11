import 'server-only';

import { rows } from './read-result';
import { createClient } from '../supabase/server';
import { requirePermission, hasPermission } from '../permissions/permissions';
import { resolveLayer1Plan } from './layer1';
import type { UserContext } from '../../types/models';

type JsonRecord = Record<string, unknown>;

function n(value: unknown): number {
  const x = Number(value ?? 0);
  return Number.isFinite(x) ? x : 0;
}

export interface ForecastRunPoint {
  runId: string;
  label: string;           // short date label
  workloadHours: number;
  requiredFte: number;
  currentSupplyFte: number;
  supplyGapFte: number;
  labourCost: number;
  budgetTarget: number;
}

export interface ForecastVisualsData {
  plans: { id: string; name: string }[];
  plan: { id: string; name: string } | null;
  series: ForecastRunPoint[];   // oldest → newest, for trend charts
  hasData: boolean;
}

/**
 * Read-only forecast series for the Visuals tab, assembled from the deterministic
 * `calculation_runs` already persisted by the engine. No calculation happens here;
 * this only reads governed output. Charts render nothing when there are no runs.
 */
export async function getForecastVisuals(
  context: UserContext,
  requestedPlanId?: string | null
): Promise<ForecastVisualsData> {
  requirePermission(context.roles, 'layer1:read');
  const supabase = await createClient();
  const { plans, plan } = await resolveLayer1Plan(context, requestedPlanId);

  if (!plan) {
    return { plans, plan: null, series: [], hasData: false };
  }

  const runsRes = await supabase
    .from('calculation_runs')
    .select('id, created_at, workload_hours, required_fte, current_supply_fte, supply_gap_fte, annual_labour_cost, annual_budget_target, run_status')
    .eq('organisation_id', context.organisationId)
    .eq('plan_id', plan.id)
    .order('created_at', { ascending: false })
    .limit(12);
  const runRows = rows<JsonRecord>('calculation runs', runsRes as never);

  // Oldest → newest for trend rendering.
  const series: ForecastRunPoint[] = runRows
    .slice()
    .reverse()
    .map((r) => {
      const created = String(r.created_at ?? '');
      return {
        runId: String(r.id),
        label: created ? created.slice(0, 10) : '—',
        workloadHours: n(r.workload_hours),
        requiredFte: n(r.required_fte),
        currentSupplyFte: n(r.current_supply_fte),
        supplyGapFte: n(r.supply_gap_fte),
        labourCost: n(r.annual_labour_cost),
        budgetTarget: n(r.annual_budget_target)
      };
    });

  return { plans, plan, series, hasData: series.length > 0 };
}

export function canReadForecastVisuals(context: UserContext): boolean {
  return hasPermission(context.roles, 'layer1:read');
}
