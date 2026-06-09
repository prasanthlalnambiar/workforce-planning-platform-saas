import { createPlanningBriefAction } from '../actions';
import { AppShell } from '../../../components/app-shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { requireUserContext } from '../../../lib/auth/session';
import { getLayer1DataSet } from '../../../lib/repositories/layer1';
import { hasPermission } from '../../../lib/permissions/permissions';
import { EmptyPlanState, Layer1Subnav, PlanSelector, money, selectedPlanId, type Layer1SearchParams } from '../_components/layer1-shared';

export default async function PlanningBriefPage({ searchParams }: { searchParams?: Layer1SearchParams }) {
  const context = await requireUserContext();
  const data = await getLayer1DataSet(context, await selectedPlanId(searchParams));
  const canWrite = hasPermission(context.roles, 'layer1:write');

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Layer 1 setup" title="Planning brief" badge="Phase 2">
          Define the planning question, decision owner, service target, budget target and boundaries before modelling demand.
        </PageHeader>
        <PlanSelector plans={data.plans} selectedPlanIdValue={data.plan?.id} />
        {data.plan ? <Layer1Subnav planId={data.plan.id} /> : <EmptyPlanState />}
        {data.plan ? (
          <section className="grid-2">
            <article className="card">
              <h2>Create planning brief</h2>
              <form className="form-grid" action={createPlanningBriefAction}>
                <input type="hidden" name="plan_id" value={data.plan.id} />
                <label className="field"><span>Decision owner</span><input name="decision_owner" placeholder="COO, Head of Operations, CFO partner..." /></label>
                <label className="field"><span>Planning horizon</span><input name="planning_horizon" placeholder="FY2027, next 12 months, Q3 uplift..." /></label>
                <label className="field"><span>Service target</span><input name="service_target" placeholder="SLA, turnaround time, backlog target..." /></label>
                <label className="field"><span>Annual budget target</span><input name="budget_target" type="number" step="1000" min="0" /></label>
                <label className="field wide"><span>Scope boundary</span><textarea name="scope_boundary" placeholder="Functions, teams, work types, locations or vendors included/excluded." /></label>
                <label className="field wide"><span>Success criteria</span><textarea name="success_criteria" placeholder="What decision should the model support?" /></label>
                <button className="button" disabled={!canWrite} type="submit">Save brief</button>
              </form>
            </article>
            <article className="card">
              <h2>Recent briefs</h2>
              <div className="table-wrap"><table><thead><tr><th>Owner</th><th>Horizon</th><th>Budget</th><th>Target</th></tr></thead><tbody>
                {data.briefs.map((brief) => <tr key={String(brief.id)}><td>{String(brief.decision_owner ?? 'Not set')}</td><td>{String(brief.planning_horizon ?? 'Not set')}</td><td>{money(brief.budget_target)}</td><td>{String(brief.service_target ?? 'Not set')}</td></tr>)}
                {data.briefs.length === 0 ? <tr><td colSpan={4}>No planning brief yet.</td></tr> : null}
              </tbody></table></div>
            </article>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
