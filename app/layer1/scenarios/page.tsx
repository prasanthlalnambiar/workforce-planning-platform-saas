import { createScenarioDefinitionAction } from '../actions';
import { AppShell } from '../../../components/app-shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { requireUserContext } from '../../../lib/auth/session';
import { getLayer1DataSet } from '../../../lib/repositories/layer1';
import { hasPermission } from '../../../lib/permissions/permissions';
import { compareLayer1Scenarios, scenarioTypeLabel } from '../../../lib/layer1/calculation-engine';
import { mapAssumptions, mapDemandRows } from '../../../lib/layer1/row-mappers';
import { EmptyPlanState, Layer1Subnav, PlanSelector, money, num, selectedPlanId, type Layer1SearchParams } from '../_components/layer1-shared';


export const dynamic = 'force-dynamic';
const scenarioTypeOptions = [
  ['base', 'Base'],
  ['high_demand', 'High demand'],
  ['productivity', 'Productivity'],
  ['ai_efficiency', 'AI efficiency'],
  ['finance_constrained', 'Finance constrained'],
  ['custom', 'Custom']
] as const;

export default async function ScenarioComparisonPage({ searchParams }: { searchParams?: Layer1SearchParams }) {
  const context = await requireUserContext();
  const data = await getLayer1DataSet(context, await selectedPlanId(searchParams));
  const canWrite = hasPermission(context.roles, 'layer1:write');
  const demand = mapDemandRows(data.demandInputs, data.sources);
  const assumptions = mapAssumptions(data.capacityAssumptions[0], data.costAssumptions[0], data.briefs[0]);
  const scenarios = demand.length > 0 ? compareLayer1Scenarios(demand, assumptions, data.scenarios) : [];

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Scenarios" title="Scenario comparison" badge="Demand">
          Compare deterministic demand, productivity, AI efficiency and finance-constrained views before any approval or baseline handoff exists.
        </PageHeader>
        <PlanSelector plans={data.plans} selectedPlanIdValue={data.plan?.id} />
        {data.plan ? <Layer1Subnav planId={data.plan.id} /> : <EmptyPlanState />}
        {data.plan ? (
          <>
            <section className="card cockpit-card">
              <div className="split-row">
                <div>
                  <p className="eyebrow">Deterministic comparison</p>
                  <h2>Base, pressure and efficiency cases</h2>
                  <p>Scenario outputs are calculated from the same stored demand inputs and assumptions after monthly frequency normalisation. No AI or approval logic is used here.</p>
                </div>
              </div>
              {scenarios.length > 0 ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Scenario</th>
                        <th>Type</th>
                        <th>Total hours</th>
                        <th>Required FTE</th>
                        <th>FTE gap</th>
                        <th>Labour cost</th>
                        <th>Budget variance</th>
                        <th>Risk flags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scenarios.map((scenario) => (
                        <tr key={`${scenario.scenarioType}-${scenario.scenarioName}`}>
                          <td><strong>{scenario.scenarioName}</strong></td>
                          <td>{scenarioTypeLabel(scenario.scenarioType)}</td>
                          <td>{num(scenario.workload.totalWorkloadHours)}</td>
                          <td>{num(scenario.requiredFte)}</td>
                          <td>{num(scenario.fteGap)}</td>
                          <td>{money(scenario.labourCost)}</td>
                          <td>{money(scenario.budgetVariance)}</td>
                          <td>{scenario.riskFlags.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p>Add demand inputs before scenario comparison becomes available.</p>}
            </section>
            <section className="grid-2">
              <article className="card">
                <h2>Add custom scenario</h2>
                <form className="form-grid" action={createScenarioDefinitionAction}>
                  <input type="hidden" name="plan_id" value={data.plan.id} />
                  <label className="field"><span>Scenario name</span><input name="scenario_name" required placeholder="Lower AHT, offshore mix, AI savings path..." /></label>
                  <label className="field"><span>Scenario type</span><select name="scenario_type">{scenarioTypeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label className="field"><span>Volume multiplier</span><input name="volume_multiplier" type="number" step="0.01" min="0" defaultValue="1" /></label>
                  <label className="field"><span>Effort/AHT multiplier</span><input name="processing_multiplier" type="number" step="0.01" min="0" defaultValue="1" /></label>
                  <label className="field"><span>Hidden work multiplier</span><input name="hidden_work_multiplier" type="number" step="0.01" min="0" defaultValue="1" /></label>
                  <label className="field"><span>Utilisation delta points</span><input name="utilisation_delta" type="number" step="0.1" defaultValue="0" /></label>
                  <label className="field"><span>Shrinkage delta points</span><input name="shrinkage_delta" type="number" step="0.1" defaultValue="0" /></label>
                  <label className="field"><span>Budget multiplier</span><input name="budget_multiplier" type="number" step="0.01" min="0" defaultValue="1" /></label>
                  <p className="small-note wide">Example: 1.15 means 15% higher. Utilisation and shrinkage deltas are entered as percentage points, so 5 means +5 points.</p>
                  <button className="button" disabled={!canWrite} type="submit">Save scenario</button>
                </form>
              </article>
              <article className="card">
                <h2>Saved custom scenarios</h2>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Name</th><th>Type</th><th>Volume</th><th>Effort</th><th>Budget</th></tr></thead>
                    <tbody>
                      {data.scenarios.filter((scenario) => scenario.id).map((scenario) => (
                        <tr key={scenario.id}>
                          <td>{scenario.name}</td>
                          <td>{scenarioTypeLabel(scenario.type)}</td>
                          <td>{num(scenario.volumeMultiplier, 2)}</td>
                          <td>{num(scenario.processingMultiplier, 2)}</td>
                          <td>{num(scenario.budgetMultiplier, 2)}</td>
                        </tr>
                      ))}
                      {data.scenarios.filter((scenario) => scenario.id).length === 0 ? <tr><td colSpan={5}>No custom scenarios saved yet. Starter scenarios are always available for comparison.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </article>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
