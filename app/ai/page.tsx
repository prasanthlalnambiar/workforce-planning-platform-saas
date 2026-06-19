import Link from 'next/link';
import { AppShell } from '../../components/app-shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { requireUserContext } from '../../lib/auth/session';
import { getAdvisoryWorkspace } from '../../lib/repositories/advisory';
import { ControlledState, displayDate, text } from '../waterfall/_components/waterfall-shared';


export const dynamic = 'force-dynamic';
export default async function AiAdvisoryPage() {
  const context = await requireUserContext();
  const data = await getAdvisoryWorkspace(context);

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
        <PageHeader eyebrow="Planning Advisor" title="Planning Advisor" badge="Advisor">
          The advisory workspace explains figures that the deterministic engine has already calculated from locked
          records. It never calculates, changes, or overrides any official FTE, cost, budget, forecast, actuals,
          variance or waterfall value — the locked records remain the single source of truth.
        </PageHeader>

        {data.readiness !== 'ready' ? (
          <ControlledState readiness={data.readiness} />
        ) : (
          <section className="card">
            <div className="split-row">
              <div><p className="eyebrow">Choose a locked variance report</p><h2>Explainable reports</h2></div>
            </div>
            <p>
              Pick a locked variance report to see a plain-language explanation of its waterfall: what moved budget to
              forecast, what moved forecast to actuals, which periods drove the variance, advisory risk flags, and
              suggested questions. All figures shown are read directly from the deterministic bridge.
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
                      <td><Link className="button button-secondary button-link" href={`/ai/${String(report.id)}`}>Open advisory</Link></td>
                    </tr>
                  ))}
                  {data.lockedVarianceReports.length === 0 ? <tr><td colSpan={5}>No locked variance reports to explain yet.</td></tr> : null}
                </tbody>
              </table>
            </div>
            <p className="small-note">
              Advisory output is descriptive only and is never written back to any record. Deterministic calculations
              remain authoritative.
            </p>
          </section>
        )}
      </div>
    </AppShell>
  );
}
