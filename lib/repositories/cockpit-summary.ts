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
      actualsAnyRes, actualsPostedRes, varianceLockedRes,
      inputSourceRes, acceptedMappingRes
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
      supabase.from('variance_reports').select('id').eq('organisation_id', orgId).in('status', ['locked', 'superseded']).limit(1),
      // Flexible-input signals (WP-2) — used for guidance only. These do NOT feed
      // any official calculation; they just help Home point to the next step.
      supabase.from('input_sources').select('id, current_version_id').eq('organisation_id', orgId).order('created_at', { ascending: false }).limit(1),
      supabase.from('field_mapping_versions').select('id').eq('organisation_id', orgId).eq('mapping_status', 'accepted').limit(1)
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
    const hasInputSource = has(inputSourceRes, 'input sources');
    const hasAcceptedMapping = has(acceptedMappingRes, 'accepted mapping');
    // Deep-link target for the mapping step: the most recent source, if one exists.
    const latestSourceRow = rows<JsonRecord>('latest input source', inputSourceRes as never)[0];
    const latestSourceId = latestSourceRow ? String(latestSourceRow.id) : null;

    // Inputs — a demand source (flexible import) or legacy manual demand counts.
    let inputs: JobStatus;
    if (!hasInputSource && !hasDemand) inputs = 'Waiting';
    else if (hasInputSource && !hasAcceptedMapping) inputs = 'Current';
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
      { job: 'Inputs', status: inputs, href: '/layer1/input-sources' },
      { job: 'Assumptions', status: assumptions, href: '/layer1/assumptions' },
      { job: 'Forecast & Budget', status: forecast, href: '/layer1/output' },
      { job: 'Track', status: track, href: '/track' }
    ];

    // Single recommended next action: walk the real planner ladder. The Inputs
    // steps guide users through the flexible-input flow (source → mapping) rather
    // than the old manual demand page. This is GUIDANCE ONLY — an accepted source
    // does not feed any official calculation in this release.
    let nextAction: NextAction | null = null;
    if (!hasPlan) {
      nextAction = { label: 'Create a plan to begin', href: '/workspace' };
    } else if (!hasInputSource && !hasDemand) {
      nextAction = { label: 'Upload or paste demand data', href: '/layer1/input-sources' };
    } else if (hasInputSource && !hasAcceptedMapping) {
      nextAction = {
        label: 'Map your demand columns',
        href: latestSourceId ? `/layer1/input-sources/${latestSourceId}` : '/layer1/input-sources'
      };
    } else if (!hasAssumptions) {
      nextAction = { label: 'Add assumptions', href: '/layer1/assumptions' };
    } else if (!hasDrivers) {
      nextAction = { label: 'Set change drivers', href: '/drivers' };
    } else if (!hasForecastOutput) {
      nextAction = { label: 'Run the forecast', href: '/layer1/output' };
    } else if (!hasLockedBaseline && !hasLockedForecast) {
      nextAction = { label: 'Review and lock the forecast', href: '/layer1/review' };
    } else if (!hasAnyActuals) {
      nextAction = { label: 'Track actuals', href: '/actuals' };
    } else if (!hasPostedActuals || !hasLockedVariance) {
      nextAction = { label: 'Create a variance report', href: '/variance' };
    } else {
      nextAction = { label: 'Open Planning Advisor to explain the movement', href: '/ai' };
    }

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
      { job: 'Inputs', status: 'Waiting', href: '/layer1/input-sources' },
      { job: 'Assumptions', status: 'Waiting', href: '/layer1/assumptions' },
      { job: 'Forecast & Budget', status: 'Waiting', href: '/layer1/output' },
      { job: 'Track', status: 'Waiting', href: '/track' }
    ],
    nextAction: null,
    advisorNote: null,
    unavailable: true
  };
}
