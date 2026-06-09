import { createLayer1AssumptionsAction } from '../actions';
import { AppShell } from '../../../components/app-shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { requireUserContext } from '../../../lib/auth/session';
import { getLayer1DataSet } from '../../../lib/repositories/layer1';
import { hasPermission } from '../../../lib/permissions/permissions';
import { mapAssumptions } from '../../../lib/layer1/row-mappers';
import { EmptyPlanState, Layer1Subnav, PlanSelector, money, num, percent, selectedPlanId, type Layer1SearchParams } from '../_components/layer1-shared';

export default async function AssumptionsPage({ searchParams }: { searchParams?: Layer1SearchParams }) {
  const context = await requireUserContext();
  const data = await getLayer1DataSet(context, await selectedPlanId(searchParams));
  const canWrite = hasPermission(context.roles, 'layer1:write');
  const assumptions = mapAssumptions(data.capacityAssumptions[0], data.costAssumptions[0], data.briefs[0]);

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Layer 1 assumptions" title="Capacity and cost assumptions" badge="Phase 2">
          Define the monthly productive capacity per FTE, current supply and labour cost assumptions used by the deterministic engine.
        </PageHeader>
        <PlanSelector plans={data.plans} selectedPlanIdValue={data.plan?.id} />
        {data.plan ? <Layer1Subnav planId={data.plan.id} /> : <EmptyPlanState />}
        {data.plan ? (
          <section className="grid-2">
            <article className="card">
              <h2>Edit assumptions</h2>
              <form className="form-grid" action={createLayer1AssumptionsAction}>
                <input type="hidden" name="plan_id" value={data.plan.id} />
                <label className="field"><span>Working days/month</span><input name="working_days" type="number" step="0.1" min="0" defaultValue={assumptions.workingDays} /></label>
                <label className="field"><span>Hours/day</span><input name="hours_per_day" type="number" step="0.1" min="0" defaultValue={assumptions.hoursPerDay} /></label>
                <label className="field"><span>Utilisation %</span><input name="utilisation" type="number" step="0.1" min="1" max="100" defaultValue={assumptions.utilisation * 100} /></label>
                <label className="field"><span>Shrinkage %</span><input name="shrinkage" type="number" step="0.1" min="0" max="95" defaultValue={assumptions.shrinkage * 100} /></label>
                <label className="field"><span>Current supply FTE</span><input name="current_supply_fte" type="number" step="0.01" min="0" defaultValue={assumptions.currentSupplyFte} /></label>
                <label className="field"><span>Annual cost/FTE</span><input name="annual_cost_per_fte" type="number" step="100" min="0" defaultValue={assumptions.annualCostPerFte} /></label>
                <label className="field"><span>Annual budget target</span><input name="annual_budget_target" type="number" step="1000" min="0" defaultValue={assumptions.annualBudgetTarget} /></label>
                <label className="field"><span>Assumption confidence %</span><input name="assumption_confidence" type="number" min="0" max="100" defaultValue={assumptions.confidenceScore ?? 70} /></label>
                <label className="field wide"><span>Assumption notes</span><textarea name="assumption_notes" defaultValue={assumptions.notes ?? ''} /></label>
                <button className="button" disabled={!canWrite} type="submit">Save assumptions</button>
              </form>
            </article>
            <article className="card cockpit-card">
              <h2>Current assumption set</h2>
              <div className="kpi-grid">
                <div className="mini-card"><span>Working days</span><strong>{num(assumptions.workingDays, 1)}</strong></div>
                <div className="mini-card"><span>Hours/day</span><strong>{num(assumptions.hoursPerDay, 1)}</strong></div>
                <div className="mini-card"><span>Utilisation</span><strong>{percent(assumptions.utilisation)}</strong></div>
                <div className="mini-card"><span>Shrinkage</span><strong>{percent(assumptions.shrinkage)}</strong></div>
                <div className="mini-card"><span>Current supply</span><strong>{num(assumptions.currentSupplyFte)}</strong></div>
                <div className="mini-card"><span>Cost/FTE</span><strong>{money(assumptions.annualCostPerFte)}</strong></div>
                <div className="mini-card"><span>Budget target</span><strong>{money(assumptions.annualBudgetTarget)}</strong></div>
                <div className="mini-card"><span>Confidence</span><strong>{num(assumptions.confidenceScore, 0)}%</strong></div>
              </div>
            </article>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
