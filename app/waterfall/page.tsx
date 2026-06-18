import Link from 'next/link';
import { AppShell } from '../../components/app-shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { requireUserContext } from '../../lib/auth/session';
import { getWaterfallDashboard } from '../../lib/repositories/waterfall';
import {
  ControlledState,
  StatCard,
  WaterfallBoundaryNote,
  displayDate,
  text
} from './_components/waterfall-shared';


export const dynamic = 'force-dynamic';
export default async function WaterfallPage() {
  const context = await requireUserContext();
  const data = await getWaterfallDashboard(context);

  const planName = (planId: unknown) => {
    const plan = data.plans.find((candidate) => String(candidate.id) === String(planId));
    return plan ? text(plan.plan_name) : 'Unknown plan';
  };
  const fiscalYearLabel = (fyId: unknown) => {
    const fy = data.fiscalYears.find((candidate) => String(candidate.id) === String(fyId));
    return fy ? text(fy.fiscal_year_label) : 'Unknown fiscal year';
  };

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Waterfall" title="Waterfall" badge="Track">
          The waterfall explains the movement from locked baseline to locked forecast and on to actuals: baseline,
          plus approved driver impacts by category, equals the locked forecast; forecast plus variance equals the
          actual result. It is a deterministic, read-only finance view anchored to a locked variance report.
        </PageHeader>

        <section className="grid-4">
          <StatCard label="Locked baseline" value={data.hasLockedBaseline ? 'Available' : 'Missing'} tone={data.hasLockedBaseline ? 'green' : undefined} />
          <StatCard label="Locked forecast" value={data.hasLockedForecast ? 'Available' : 'Missing'} tone={data.hasLockedForecast ? 'green' : undefined} />
          <StatCard label="Posted actuals" value={data.hasPostedActuals ? 'Available' : 'Missing'} tone={data.hasPostedActuals ? 'green' : undefined} />
          <StatCard label="Locked variance" value={data.lockedVarianceReports.length} note="Available bridge anchors" tone={data.hasLockedVariance ? 'green' : undefined} />
        </section>

        {data.readiness !== 'ready' ? (
          <ControlledState readiness={data.readiness} />
        ) : (
          <section className="card">
            <div className="split-row">
              <div><p className="eyebrow">Bridge anchors</p><h2>Locked variance reports</h2></div>
            </div>
            <p>
              Each locked variance report pins a baseline, a forecast version and an actuals version. Open one to see
              the full baseline-to-actuals bridge for its covered periods.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Report</th><th>Plan / FY</th><th>Status</th><th>Locked</th><th></th></tr>
                </thead>
                <tbody>
                  {data.lockedVarianceReports.map((report) => (
                    <tr key={String(report.id)}>
                      <td><strong>{text(report.report_code)}</strong> · {text(report.report_name)}</td>
                      <td>{planName(report.plan_id)}<br /><span className="small-note">{fiscalYearLabel(report.fiscal_year_id)}</span></td>
                      <td>{text(report.status)}{report.is_current_locked === true ? ' · current' : ''}</td>
                      <td>{report.locked_at ? displayDate(report.locked_at) : '—'}</td>
                      <td><Link className="button button-secondary button-link" href={`/waterfall/${String(report.id)}`}>Open bridge</Link></td>
                    </tr>
                  ))}
                  {data.lockedVarianceReports.length === 0 ? <tr><td colSpan={5}>No locked variance reports yet.</td></tr> : null}
                </tbody>
              </table>
            </div>
            <WaterfallBoundaryNote />
          </section>
        )}
      </div>
    </AppShell>
  );
}
