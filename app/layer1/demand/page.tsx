import { createDemandInputAction } from '../actions';
import { AppShell } from '../../../components/app-shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { requireUserContext } from '../../../lib/auth/session';
import { demandCategories, getLayer1DataSet } from '../../../lib/repositories/layer1';
import { hasPermission } from '../../../lib/permissions/permissions';
import { EmptyPlanState, Layer1Subnav, PlanSelector, num, selectedPlanId, type Layer1SearchParams } from '../_components/layer1-shared';


export const dynamic = 'force-dynamic';
export default async function DemandInputsPage({ searchParams }: { searchParams?: Layer1SearchParams }) {
  const context = await requireUserContext();
  const data = await getLayer1DataSet(context, await selectedPlanId(searchParams));
  const canWrite = hasPermission(context.roles, 'layer1:write');

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Layer 1 demand" title="Demand inputs" badge="Phase 2">
          Capture measured work where systems exist, and explicitly estimate hidden or internal work where tools do not capture the full workload.
        </PageHeader>
        <PlanSelector plans={data.plans} selectedPlanIdValue={data.plan?.id} />
        {data.plan ? <Layer1Subnav planId={data.plan.id} /> : <EmptyPlanState />}
        {data.plan ? (
          <section className="grid-2">
            <article className="card">
              <h2>Add demand input</h2>
              <form className="form-grid" action={createDemandInputAction}>
                <input type="hidden" name="plan_id" value={data.plan.id} />
                <label className="field wide"><span>Demand category</span><select name="demand_category">{demandCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>
                <label className="field"><span>Work type</span><input name="work_type_label" required placeholder="Calls, claims research, offline huddles..." /></label>
                <label className="field"><span>Source evidence</span><select name="source_id"><option value="">No source attached</option>{data.sources.map((source) => <option key={String(source.id)} value={String(source.id)}>{String(source.source_name)}</option>)}</select></label>
                <label className="field"><span>Volume</span><input name="demand_volume" type="number" step="0.01" min="0" placeholder="Monthly count" /></label>
                <label className="field"><span>Effort minutes</span><input name="processing_minutes" type="number" step="0.01" min="0" placeholder="AHT or effort per item" /></label>
                <label className="field"><span>Hidden/project hours</span><input name="hidden_work_hours" type="number" step="0.01" min="0" placeholder="Use for work not volume based" /></label>
                <label className="field"><span>Frequency</span><select name="frequency"><option value="monthly">monthly</option><option value="weekly">weekly</option><option value="daily">daily</option><option value="one_off">one off</option></select></label>
                <label className="field"><span>Source quality %</span><input name="source_quality_score" type="number" min="0" max="100" defaultValue="70" /></label>
                <label className="field"><span>Confidence %</span><input name="confidence_score" type="number" min="0" max="100" defaultValue="70" /></label>
                <label className="field wide"><span>Notes/commentary</span><textarea name="rationale" placeholder="How was this estimate formed? What ambiguity remains?" /></label>
                <button className="button" disabled={!canWrite} type="submit">Add demand</button>
              </form>
            </article>
            <article className="card">
              <h2>Demand list</h2>
              <div className="table-wrap"><table><thead><tr><th>Category</th><th>Work type</th><th>Volume</th><th>Minutes</th><th>Hidden hours</th><th>Confidence</th></tr></thead><tbody>
                {data.demandInputs.map((input) => <tr key={String(input.id)}><td>{String(input.demand_category)}</td><td>{String(input.work_type_label)}</td><td>{num(input.demand_volume, 0)}</td><td>{num(input.processing_minutes)}</td><td>{num(input.hidden_work_hours)}</td><td>{num(input.confidence_score, 0)}%</td></tr>)}
                {data.demandInputs.length === 0 ? <tr><td colSpan={6}>No demand inputs yet.</td></tr> : null}
              </tbody></table></div>
            </article>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
