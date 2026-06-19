import 'server-only';

import { rows } from './read-result';
import { createClient } from '../supabase/server';
import type { UserContext } from '../../types/models';

type JsonRecord = Record<string, unknown>;

export type JobStatus = 'Not started' | 'Current' | 'Needs review' | 'Complete' | 'Waiting';

export interface JobState {
  job: 'Inputs' | 'Assumptions' | 'Forecast & Budget' | 'Track';
  status: JobStatus;
  href: string;
}

export interface NextAction {
  label: string;
  href: string;
}

export interface CockpitSummary {
  hasPlan: boolean;
  jobs: JobState[];
  nextAction: NextAction | null;
  /** A conservative one-line advisor note, only when real data supports it. */
  advisorNote: string | null;
  /** True when the underlying reads could not be completed (controlled state). */
  unavailable: boolean;
}

/**
 * Read-only composition of EXISTING governed signals into the cockpit status
 * strip. Adds no table, no RPC, no write. Reads run through rows() so a
 * database/RLS failure surfaces as a controlled unavailable state rather than a
 * false "everything not started". The status is intentionally conservative:
 * where an exact state cannot be safely derived, it reports the earlier/safer
 * label rather than inventing precision.
 */
export async function getCockpitSummary(context: UserContext): Promise<CockpitSummary> {
  const orgId = context.organisationId;

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return emptyUnavailable();
  }

  try {
    const [
      plansRes, demandRes, assumptionsRes, driversRes,
      baselineLockedRes, forecastOutputRes, reforecastLockedRes,
      actualsAnyRes, actualsPostedRes, varianceLockedRes
    ] = await Promise.all([
      supabase.from('plans').select('id').eq('organisation_id', orgId).limit(1),
      // Inputs signal: any demand/source input exists.
      supabase.from('demand_inputs').select('id').eq('organisation_id', orgId).limit(1),
      // Assumptions signal: capacity/cost assumptions exist.
      supabase.from('capacity_assumptions').select('id').eq('organisation_id', orgId).limit(1),
      supabase.from('forecast_drivers').select('id').eq('organisation_id', orgId).limit(1),
      // Forecast & Budget signals.
      supabase.from('budget_baselines').select('id').eq('organisation_id', orgId).eq('status', 'locked').limit(1),
      supabase.from('layer1_handoff_objects').select('id').eq('organisation_id', orgId).limit(1),
      supabase.from('reforecasts').select('id').eq('organisation_id', orgId).in('status', ['locked', 'superseded']).limit(1),
      // Track signals.
      supabase.from('actuals_batches').select('id').eq('organisation_id', orgId).limit(1),
      supabase.from('actuals_batches').select('id').eq('organisation_id', orgId).eq('status', 'posted').limit(1),
      supabase.from('variance_reports').select('id').eq('organisation_id', orgId).in('status', ['locked', 'superseded']).limit(1)
    ]);

    const has = (res: unknown, label: string) => rows<JsonRecord>(label, res as never).length > 0;

    const hasPlan = has(plansRes, 'plans');
    const hasDemand = has(demandRes, 'demand inputs');
    const hasAssumptions = has(assumptionsRes, 'assumptions');
    const hasDrivers = has(driversRes, 'drivers');
    const hasLockedBaseline = has(baselineLockedRes, 'locked baseline');
    const hasForecastOutput = has(forecastOutputRes, 'forecast output');
    const hasLockedForecast = has(reforecastLockedRes, 'locked forecast');
    const hasAnyActuals = has(actualsAnyRes, 'actuals');
    const hasPostedActuals = has(actualsPostedRes, 'posted actuals');
    const hasLockedVariance = has(varianceLockedRes, 'locked variance');

    // Inputs
    let inputs: JobStatus;
    if (!hasDemand) inputs = 'Waiting';
    else if (!hasForecastOutput) inputs = 'Current';
    else inputs = 'Complete';

    // Assumptions
    let assumptions: JobStatus;
    if (!hasAssumptions) assumptions = 'Waiting';
    else if (!hasDrivers) assumptions = 'Current';
    else assumptions = 'Complete';

    // Forecast & Budget
    let forecast: JobStatus;
    if (hasLockedBaseline || hasLockedForecast) forecast = 'Complete';
    else if (hasForecastOutput) forecast = 'Current';
    else forecast = 'Waiting';

    // Track
    let track: JobStatus;
    if (hasPostedActuals || hasLockedVariance) track = hasLockedVariance ? 'Complete' : 'Current';
    else if (hasAnyActuals) track = 'Current';
    else track = 'Waiting';

    const jobs: JobState[] = [
      { job: 'Inputs', status: inputs, href: '/layer1' },
      { job: 'Assumptions', status: assumptions, href: '/layer1/assumptions' },
      { job: 'Forecast & Budget', status: forecast, href: '/baseline' },
      { job: 'Track', status: track, href: '/actuals' }
    ];

    // Single recommended next action: the earliest job that is not complete.
    let nextAction: NextAction | null = null;
    if (!hasPlan) nextAction = { label: 'Create a plan to begin', href: '/workspace' };
    else if (inputs !== 'Complete') nextAction = { label: 'Enter demand inputs', href: '/layer1/demand' };
    else if (assumptions !== 'Complete') nextAction = { label: 'Review assumptions', href: '/layer1/assumptions' };
    else if (forecast !== 'Complete') nextAction = { label: 'Review and lock the forecast', href: '/baseline' };
    else if (track === 'Waiting') nextAction = { label: 'Upload actuals in Track', href: '/actuals' };
    else if (track === 'Current') nextAction = { label: 'Post actuals and create a variance report', href: '/variance' };
    else nextAction = { label: 'Open Planning Advisor to explain the movement', href: '/ai' };

    // Conservative advisor note: only assert the forecast-vs-baseline direction
    // when a locked forecast exists. Never invent precision.
    const advisorNote = hasLockedForecast
      ? 'A locked forecast is in place. Open Planning Advisor in Track for a governed explanation of the movement from baseline to forecast and actuals.'
      : null;

    return { hasPlan, jobs, nextAction, advisorNote, unavailable: false };
  } catch {
    return emptyUnavailable();
  }
}

function emptyUnavailable(): CockpitSummary {
  return {
    hasPlan: false,
    jobs: [
      { job: 'Inputs', status: 'Waiting', href: '/layer1' },
      { job: 'Assumptions', status: 'Waiting', href: '/layer1/assumptions' },
      { job: 'Forecast & Budget', status: 'Waiting', href: '/baseline' },
      { job: 'Track', status: 'Waiting', href: '/actuals' }
    ],
    nextAction: null,
    advisorNote: null,
    unavailable: true
  };
}
