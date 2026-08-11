import { AppShell } from '../../../components/app-shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { requireUserContext } from '../../../lib/auth/session';
import { getForecastVisuals } from '../../../lib/repositories/forecast-visuals';
import { Layer1Subnav } from '../../layer1/_components/layer1-shared';
import { LineChart, GroupedBarChart, ChartLegend, type Series } from './_components/mini-charts';

export const dynamic = 'force-dynamic';

function fmtInt(n: number): string {
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 }).format(n);
}
function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n);
}

export default async function ForecastVisualsPage({ searchParams }: { searchParams?: Promise<{ planId?: string }> }) {
  const context = await requireUserContext();
  const params = await searchParams;
  const data = await getForecastVisuals(context, params?.planId).catch(() => null);

  const labels = data?.series.map((p) => p.label) ?? [];
  const volumeSeries: Series[] = [
    { name: 'Workload hours', color: '#2563eb', values: data?.series.map((p) => p.workloadHours) ?? [] }
  ];
  const fteSeries: Series[] = [
    { name: 'Required FTE', color: '#dc2626', values: data?.series.map((p) => p.requiredFte) ?? [] },
    { name: 'Current supply FTE', color: '#16a34a', values: data?.series.map((p) => p.currentSupplyFte) ?? [] }
  ];
  const costSeries: Series[] = [
    { name: 'Labour cost', color: '#7c3aed', values: data?.series.map((p) => p.labourCost) ?? [] },
    { name: 'Budget target', color: '#f59e0b', values: data?.series.map((p) => p.budgetTarget) ?? [] }
  ];

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Forecast & Budget" title="Visuals" badge="Read only">
          Charts of the deterministic, governed forecast output for this plan. They read stored
          calculation results only — nothing here recalculates or changes an official number. Each
          chart&apos;s horizontal axis is successive forecast runs (newest on the right), not calendar
          periods; true period-level demand charting is a later step.
        </PageHeader>

        <Layer1Subnav tab="Forecast & Budget" planId={data?.plan?.id} />

        {!data || !data.plan ? (
          <section className="card"><p className="small-note">Select or create a plan to see forecast visuals.</p></section>
        ) : !data.hasData ? (
          <section className="card">
            <p className="eyebrow">No forecast runs yet</p>
            <p className="small-note">
              Run a forecast for <strong>{data.plan.name}</strong> to populate these charts. Visuals
              appear once deterministic output exists — they are never drawn from placeholder data.
            </p>
          </section>
        ) : (
          <>
            <section className="card">
              <p className="eyebrow">Workload hours by forecast run</p>
              <p className="small-note">Each point is a calculation run for this plan, newest on the right — not a weekly/monthly demand curve.</p>
              <LineChart labels={labels} series={volumeSeries} format={fmtInt} />
              <ChartLegend series={volumeSeries} />
            </section>

            <section className="card">
              <p className="eyebrow">Required FTE vs current supply</p>
              <LineChart labels={labels} series={fteSeries} format={(n) => fmtInt(n)} />
              <ChartLegend series={fteSeries} />
            </section>

            <section className="card">
              <p className="eyebrow">Labour cost vs budget target</p>
              <GroupedBarChart labels={labels} series={costSeries} format={fmtMoney} />
              <ChartLegend series={costSeries} />
            </section>
          </>
        )}

        <section className="card">
          <p className="eyebrow">Workload by workflow / channel</p>
          <p className="small-note">
            This breakdown needs per-workflow forecast output, which the current deterministic run
            does not persist. It arrives with richer per-workflow output in a later visuals step —
            it is intentionally not shown as placeholder data here.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
