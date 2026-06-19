import { createPlanAction } from '../actions';
import { AppShell } from '../../components/app-shell/app-shell';
import { Badge } from '../../components/ui/badge';
import { PageHeader } from '../../components/ui/page-header';
import { requireUserContext } from '../../lib/auth/session';
import { listPlans } from '../../lib/repositories/plans';
import { getCockpitSummary, type JobStatus } from '../../lib/repositories/cockpit-summary';
import { hasPermission } from '../../lib/permissions/permissions';
import Link from 'next/link';


export const dynamic = 'force-dynamic';
export default async function HomePage() {
  const context = await requireUserContext();
  const [plans, summary] = await Promise.all([listPlans(context), getCockpitSummary(context)]);
  const canCreate = hasPermission(context.roles, 'workspace:create_plan');
  const activePlan = plans[0];

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Planning cockpit" title="Home" badge="Tenant scoped">
          Where you are in this planning cycle, what is complete, and your next action.
        </PageHeader>

        {activePlan ? (
          <p className="small-note">
            {String(activePlan.plan_name)} · {context.email}
          </p>
        ) : null}

        {summary.unavailable ? (
          <section className="card">
            <p className="eyebrow">Cockpit unavailable</p>
            <h2>Status could not be loaded</h2>
            <p>The planning records could not be read just now. This is a controlled state, not an empty plan. Try again shortly, or check that the database is reachable.</p>
          </section>
        ) : (
          <>
            <section className="card">
              <div className="split-row">
                <div><p className="eyebrow">Planning status</p><h2>Your plan at a glance</h2></div>
              </div>
              <div className="grid-4">
                {summary.jobs.map((job) => (
                  <Link key={job.job} href={job.href} className="metric metric-link">
                    <span>{job.job}</span>
                    <strong><StatusBadge status={job.status} /></strong>
                  </Link>
                ))}
              </div>
            </section>

            {summary.nextAction ? (
              <section className="card">
                <div className="split-row">
                  <div>
                    <p className="eyebrow">Next action</p>
                    <h2>{summary.nextAction.label}</h2>
                  </div>
                  <Link className="button button-link" href={summary.nextAction.href}>Go</Link>
                </div>
                {summary.advisorNote ? <p className="small-note">Planning Advisor: {summary.advisorNote}</p> : null}
              </section>
            ) : (
              <section className="card">
                <p className="eyebrow">Getting started</p>
                <h2>No locked forecast yet</h2>
                <p>Complete Inputs and Assumptions, then review Forecast &amp; Budget and lock a forecast before tracking variance.</p>
              </section>
            )}
          </>
        )}

        <section className="card">
          <h2>Plans</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Plan</th><th>Status</th><th>Type</th></tr></thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={String(plan.id)}>
                    <td>{String(plan.plan_name)}</td>
                    <td><Badge>{String(plan.status)}</Badge></td>
                    <td>{String(plan.plan_type)}</td>
                  </tr>
                ))}
                {plans.length === 0 ? <tr><td colSpan={3}>No plans yet. Create one below to begin.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <h2>Create a plan</h2>
          <p>Creates the plan container that your demand inputs, assumptions, forecast and actuals hang from.</p>
          <form className="form-grid" action={createPlanAction}>
            <label className="field">
              <span>Plan name</span>
              <input name="plan_name" required placeholder="FY2027 Customer Operations Plan" />
            </label>
            <label className="field wide">
              <span>Description</span>
              <textarea name="plan_description" placeholder="Short description of this plan." />
            </label>
            <button className="button" disabled={!canCreate} type="submit">Create plan</button>
          </form>
        </section>
      </div>
    </AppShell>
  );
}

function StatusBadge({ status }: { status: JobStatus }) {
  const tone = status === 'Complete' ? 'green' : status === 'Current' || status === 'Needs review' ? 'warm' : 'neutral';
  return <Badge tone={tone}>{status}</Badge>;
}
