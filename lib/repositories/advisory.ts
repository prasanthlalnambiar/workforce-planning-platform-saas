import 'server-only';

import {
  buildWaterfallAdvisory,
  type WaterfallAdvisory
} from '../advisory/advisory-engine';
import {
  getWaterfallDashboard,
  getWaterfallDetail,
  type WaterfallContext
} from './waterfall';
import { hasPermission, requirePermission } from '../permissions/permissions';
import type { WaterfallReadiness } from '../waterfall/waterfall-engine';
import type { UserContext } from '../../types/models';

type JsonRecord = Record<string, unknown>;

function text(value: unknown, fallback = ''): string {
  const candidate = String(value ?? '').trim();
  return candidate || fallback;
}

export function canReadAdvisory(context: UserContext): boolean {
  return hasPermission(context.roles, 'ai:read');
}

export interface AdvisoryWorkspaceData {
  readiness: WaterfallReadiness;
  lockedVarianceReports: JsonRecord[];
  plans: JsonRecord[];
  fiscalYears: JsonRecord[];
}

/**
 * Workspace list for the /ai advisory page: the locked variance reports that can
 * be explained. This delegates entirely to the Phase 8 waterfall dashboard
 * loader, so the AI layer inherits the same locked-only governance and the same
 * error-surfacing (no false empty states) without reading any record itself.
 */
export async function getAdvisoryWorkspace(context: UserContext): Promise<AdvisoryWorkspaceData> {
  requirePermission(context.roles, 'ai:read');
  const dashboard = await getWaterfallDashboard(context);
  return {
    readiness: dashboard.readiness,
    lockedVarianceReports: dashboard.lockedVarianceReports,
    plans: dashboard.plans,
    fiscalYears: dashboard.fiscalYears
  };
}

export interface AdvisoryDetailData {
  readiness: WaterfallReadiness;
  context: WaterfallContext;
  advisory: WaterfallAdvisory | null;
  /** Surfaced when the bridge is not in a state that can be explained. */
  unavailableReason: string | null;
}

/**
 * Build the advisory for one locked variance report. The deterministic waterfall
 * bridge is produced by the Phase 8 loader (which enforces locked statuses and
 * pinned-source consistency); the advisory engine then explains those finished
 * numbers in prose. The advisory NEVER recomputes or alters a figure, and this
 * function performs no writes.
 */
export async function getAdvisoryDetail(context: UserContext, varianceReportId: string): Promise<AdvisoryDetailData> {
  requirePermission(context.roles, 'ai:read');

  // Reuse the waterfall detail loader verbatim: same locked-source governance,
  // same pinned-source validation, same controlled states.
  const detail = await getWaterfallDetail(context, varianceReportId);

  if (detail.readiness !== 'ready' || !detail.bridge) {
    return {
      readiness: detail.readiness,
      context: detail.context,
      advisory: null,
      unavailableReason:
        detail.readiness === 'inconsistent_pinned_sources'
          ? 'The waterfall could not be built from consistent locked sources, so no advisory can be produced.'
          : 'The waterfall for this report is not in a complete, locked state, so no advisory can be produced.'
    };
  }

  const report = detail.context.varianceReport;
  const advisory = buildWaterfallAdvisory({
    bridge: detail.bridge,
    context: {
      reportCode: text(report?.report_code, 'variance report'),
      reportName: text(report?.report_name),
      planName: text(detail.context.plan?.plan_name),
      fiscalYearLabel: text(detail.context.fiscalYear?.fiscal_year_label)
    }
  });

  return { readiness: 'ready', context: detail.context, advisory, unavailableReason: null };
}
