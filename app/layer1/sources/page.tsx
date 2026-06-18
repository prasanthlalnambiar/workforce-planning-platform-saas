import { createSourceInventoryAction } from '../actions';
import { AppShell } from '../../../components/app-shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { requireUserContext } from '../../../lib/auth/session';
import { getLayer1DataSet } from '../../../lib/repositories/layer1';
import { hasPermission } from '../../../lib/permissions/permissions';
import { EmptyPlanState, Layer1Subnav, PlanSelector, num, selectedPlanId, type Layer1SearchParams } from '../_components/layer1-shared';


export const dynamic = 'force-dynamic';
const sourceTypes = ['wfm', 'crm', 'case_system', 'finance_plan', 'sales_forecast', 'stakeholder_interview', 'manual_tracker', 'calendar_sample', 'benchmark', 'unknown', 'other'];

export default async function SourcesPage({ searchParams }: { searchParams?: Layer1SearchParams }) {
  const context = await requireUserContext();
  const data = await getLayer1DataSet(context, await selectedPlanId(searchParams));
  const canWrite = hasPermission(context.roles, 'layer1:write');

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Source quality" title="Source inventory" badge="Demand">
          Capture where demand signals come from, how complete they are and how much confidence the model should place in them.
        </PageHeader>
        <PlanSelector plans={data.plans} selectedPlanIdValue={data.plan?.id} />
        {data.plan ? <Layer1Subnav planId={data.plan.id} /> : <EmptyPlanState />}
        {data.plan ? (
          <section className="grid-2">
            <article className="card">
              <h2>Add source</h2>
              <form className="form-grid" action={createSourceInventoryAction}>
                <input type="hidden" name="plan_id" value={data.plan.id} />
                <label className="field"><span>Source name</span><input name="source_name" required placeholder="Genesys call data, Salesforce cases, stakeholder interview..." /></label>
                <label className="field"><span>Source type</span><select name="source_type">{sourceTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
                <label className="field"><span>Owner</span><input name="owner" /></label>
                <label className="field"><span>Recency</span><input name="recency" placeholder="Current, FY2026, sampled month..." /></label>
                <label className="field"><span>Completeness score %</span><input name="completeness_score" type="number" min="0" max="100" defaultValue="70" /></label>
                <label className="field"><span>Source quality score %</span><input name="source_quality_score" type="number" min="0" max="100" defaultValue="70" /></label>
                <label className="field"><span>Duplicate risk</span><select name="duplicate_risk"><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label>
                <button className="button" disabled={!canWrite} type="submit">Add source</button>
              </form>
            </article>
            <article className="card">
              <h2>Source list</h2>
              <div className="table-wrap"><table><thead><tr><th>Source</th><th>Type</th><th>Quality</th><th>Completeness</th></tr></thead><tbody>
                {data.sources.map((source) => <tr key={String(source.id)}><td>{String(source.source_name)}</td><td>{String(source.source_type)}</td><td>{num(source.source_quality_score, 0)}%</td><td>{num(source.completeness_score, 0)}%</td></tr>)}
                {data.sources.length === 0 ? <tr><td colSpan={4}>No sources captured yet.</td></tr> : null}
              </tbody></table></div>
            </article>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
