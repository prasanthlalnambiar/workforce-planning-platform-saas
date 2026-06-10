import { AppShell } from '../../components/app-shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { requireUserContext } from '../../lib/auth/session';
import { getLayer1DataSet } from '../../lib/repositories/layer1';
import { calculateLayer1Output } from '../../lib/layer1/calculation-engine';
import { mapAssumptions, mapDemandRows } from '../../lib/layer1/row-mappers';
import { EmptyPlanState, Layer1Subnav, PlanSelector, StatCard, money, num, selectedPlanId, type Layer1SearchParams } from './_components/layer1-shared';


export const dynamic = 'force-dynamic';
export default async function Layer1DashboardPage({ searchParams }: { searchParams?: Layer1SearchParams }) {
  const context = await requireUserContext();
  const planId = await selectedPlanId(searchParams);
  const data = await getLayer1DataSet(context, planId);
  const demand = mapDemandRows(data.demandInputs, data.sources);
  const assumptions = mapAssumptions(data.capacityAssumptions[0], data.costAssumptions[0], data.briefs[0]);
  const output = demand.length > 0 ? calculateLayer1Output(demand, assumptions) : null;

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Layer 1 deterministic engine" title="Demand-to-budget cockpit" badge="Phase 2">
          Convert messy demand, measured work and hidden internal effort into workload hours, required FTE, supply gap and labour budget outputs. No approval lock or Layer 2 handoff is built in this phase.
        </PageHeader>
        <PlanSelector plans={data.plans} selectedPlanIdValue={data.plan?.id} />
        {data.plan ? <Layer1Subnav planId={data.plan.id} /> : null}
        {!data.plan ? <EmptyPlanState /> : (
          <>
            <section className="grid-4">
              <StatCard label="Planning briefs" value={data.briefs.length} />
              <StatCard label="Sources" value={data.sources.length} />
              <StatCard label="Demand inputs" value={data.demandInputs.length} />
              <StatCard label="Calculation runs" value={data.calculationRuns.length} />
            </section>
            <section className="grid-2">
              <article className="card cockpit-card">
                <p className="eyebrow">Current deterministic view</p>
                <h2>{data.plan.name}</h2>
                {output ? (
                  <div className="kpi-grid">
                    <StatCard label="Total workload hours" value={num(output.workload.totalWorkloadHours)} />
                    <StatCard label="Required FTE" value={num(output.requiredFte)} />
                    <StatCard label="FTE gap" value={num(output.fteGap)} tone={output.fteGap > 0 ? 'warm' : 'green'} />
                    <StatCard label="Labour cost" value={money(output.labourCost)} />
                  </div>
                ) : <p>Add demand inputs to generate a deterministic preview.</p>}
              </article>
              <article className="card cockpit-card">
                <p className="eyebrow">Model readiness</p>
                <h2>What is missing?</h2>
                <ul className="check-list">
                  <li>{data.briefs.length > 0 ? 'Planning brief captured' : 'Add a planning brief'}</li>
                  <li>{data.sources.length > 0 ? 'Source inventory started' : 'Add source evidence'}</li>
                  <li>{data.demandInputs.length > 0 ? 'Demand inputs captured' : 'Add demand inputs'}</li>
                  <li>{data.capacityAssumptions.length > 0 && data.costAssumptions.length > 0 ? 'Capacity and cost assumptions captured' : 'Add assumptions'}</li>
                  <li>{data.calculationRuns.length > 0 ? 'Calculation run saved' : 'Run calculation when ready'}</li>
                </ul>
              </article>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
