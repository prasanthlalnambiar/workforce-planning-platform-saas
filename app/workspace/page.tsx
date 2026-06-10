import { createPlanAction } from '../actions';
import { AppShell } from '../../components/app-shell/app-shell';
import { Badge } from '../../components/ui/badge';
import { PageHeader } from '../../components/ui/page-header';
import { requireUserContext } from '../../lib/auth/session';
import { listPlans } from '../../lib/repositories/plans';
import { hasPermission } from '../../lib/permissions/permissions';


export const dynamic = 'force-dynamic';
export default async function WorkspacePage() {
  const context = await requireUserContext();
  const plans = await listPlans(context);
  const canCreate = hasPermission(context.roles, 'workspace:create_plan');

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Phase 1 foundation" title="Workspace" badge="Tenant scoped">
          Plans are scoped to the authenticated user&apos;s organisation. Future Layer 1 and Layer 2 records will hang from this workspace.
        </PageHeader>
        <section className="grid-4">
          <Metric label="Plans" value={plans.length} />
          <Metric label="Roles" value={context.roles.length} />
          <Metric label="Foundation" value="P1" />
          <Metric label="AI" value="Off" />
        </section>
        <section className="card">
          <h2>Create plan</h2>
          <p>Creates only the plan container. No calculator or forecasting logic is included in Phase 1.</p>
          <form className="form-grid" action={createPlanAction}>
            <label className="field">
              <span>Plan name</span>
              <input name="plan_name" required placeholder="FY2027 Operations Workforce Budget Plan" />
            </label>
            <label className="field wide">
              <span>Description</span>
              <textarea name="plan_description" placeholder="Short description of the planning workspace." />
            </label>
            <button className="button" disabled={!canCreate} type="submit">Create plan</button>
          </form>
        </section>
        <section className="card">
          <h2>Plan list</h2>
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
                {plans.length === 0 ? <tr><td colSpan={3}>No plans yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong></article>;
}
