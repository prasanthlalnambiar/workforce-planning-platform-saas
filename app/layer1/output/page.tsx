import { runLayer1CalculationAction } from '../actions';
import { AppShell } from '../../../components/app-shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { requireUserContext } from '../../../lib/auth/session';
import { getLayer1DataSet } from '../../../lib/repositories/layer1';
import { hasPermission } from '../../../lib/permissions/permissions';
import { calculateLayer1Output } from '../../../lib/layer1/calculation-engine';
import { mapAssumptions, mapDemandRows } from '../../../lib/layer1/row-mappers';
import { EmptyPlanState, Layer1Subnav, PlanSelector, StatCard, money, num, selectedPlanId, type Layer1SearchParams } from '../_components/layer1-shared';

export default async function CalculationOutputPage({ searchParams }: { searchParams?: Layer1SearchParams }) {
  const context = await requireUserContext();
  const data = await getLayer1DataSet(context, await selectedPlanId(searchParams));
  const canWrite = hasPermission(context.roles, 'layer1:write');
  const demand = mapDemandRows(data.demandInputs, data.sources);
  const assumptions = mapAssumptions(data.capacityAssumptions[0], data.costAssumptions[0], data.briefs[0]);
  const output = demand.length > 0 ? calculateLayer1Output(demand, assumptions) : null;

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Layer 1 output" title="Calculation output" badge="Phase 2">
          Run and inspect the deterministic workload, FTE, supply gap and labour budget result. This is not an approval lock and does not feed Layer 2 yet.
        </PageHeader>
        <PlanSelector plans={data.plans} selectedPlanIdValue={data.plan?.id} />
        {data.plan ? <Layer1Subnav planId={data.plan.id} /> : <EmptyPlanState />}
        {data.plan ? (
          <>
            <section className="card cockpit-card">
              <div className="split-row">
                <div><p className="eyebrow">Deterministic run</p><h2>Demand to FTE and budget</h2></div>
                <form action={runLayer1CalculationAction}>
                  <input type="hidden" name="plan_id" value={data.plan.id} />
                  <button className="button" disabled={!canWrite || demand.length === 0} type="submit">Run calculation</button>
                </form>
              </div>
              {output ? (
                <div className="grid-4">
                  <StatCard label="Measured hours" value={num(output.workload.measuredWorkloadHours)} />
                  <StatCard label="Estimated hours" value={num(output.workload.estimatedWorkloadHours)} />
                  <StatCard label="Hidden hours" value={num(output.workload.hiddenWorkloadHours)} />
                  <StatCard label="Total hours" value={num(output.workload.totalWorkloadHours)} />
                  <StatCard label="Productive hours/FTE" value={num(output.productiveHoursPerFte)} />
                  <StatCard label="Required FTE" value={num(output.requiredFte)} />
                  <StatCard label="FTE gap" value={num(output.fteGap)} tone={output.fteGap > 0 ? 'warm' : 'green'} />
                  <StatCard label="Labour cost" value={money(output.labourCost)} />
                  <StatCard label="Budget target" value={money(output.budgetTarget)} />
                  <StatCard label="Budget variance" value={money(output.budgetVariance)} tone={output.budgetVariance > 0 ? 'warm' : 'green'} />
                  <StatCard label="Source quality" value={`${num(output.sourceQualityScore, 0)}%`} />
                  <StatCard label="Confidence" value={`${num(output.confidenceScore, 0)}%`} />
                </div>
              ) : <p>Add demand inputs before running a calculation.</p>}
            </section>
            {output ? <section className="card"><h2>Risk flags</h2><div className="risk-list">{output.riskFlags.map((flag) => <article key={flag.code} className={`risk risk-${flag.severity}`}><strong>{flag.severity}</strong><span>{flag.message}</span></article>)}</div></section> : null}
            <section className="card"><h2>Saved calculation runs</h2><div className="table-wrap"><table><thead><tr><th>Created</th><th>Required FTE</th><th>Gap</th><th>Cost</th><th>Variance</th><th>Confidence</th></tr></thead><tbody>
              {data.calculationRuns.map((run) => <tr key={String(run.id)}><td>{String(run.created_at ?? '')}</td><td>{num(run.required_fte)}</td><td>{num(run.supply_gap_fte)}</td><td>{money(run.annual_labour_cost)}</td><td>{money(run.variance_to_target)}</td><td>{num(run.confidence_score, 0)}%</td></tr>)}
              {data.calculationRuns.length === 0 ? <tr><td colSpan={6}>No saved calculation runs yet.</td></tr> : null}
            </tbody></table></div></section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
