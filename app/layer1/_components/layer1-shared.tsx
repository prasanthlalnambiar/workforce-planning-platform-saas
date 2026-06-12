import Link from 'next/link';
import { Badge } from '../../../components/ui/badge';
import type { Layer1SelectedPlan } from '../../../lib/repositories/layer1';

export type Layer1SearchParams = Promise<{ planId?: string }> | undefined;

export async function selectedPlanId(searchParams: Layer1SearchParams): Promise<string | undefined> {
  const params = await searchParams;
  return params?.planId;
}

const layer1Links = [
  ['Dashboard', '/layer1'],
  ['Planning brief', '/layer1/brief'],
  ['Sources', '/layer1/sources'],
  ['Demand inputs', '/layer1/demand'],
  ['Assumptions', '/layer1/assumptions'],
  ['Output', '/layer1/output'],
  ['Scenarios', '/layer1/scenarios'],
  ['Review & handoff', '/layer1/review']
] as const;

export function Layer1Subnav({ planId }: { planId?: string }) {
  const suffix = planId ? `?planId=${planId}` : '';
  return (
    <nav className="subnav" aria-label="Layer 1 navigation">
      {layer1Links.map(([label, href]) => <Link key={href} href={`${href}${suffix}`}>{label}</Link>)}
    </nav>
  );
}

export function PlanSelector({ plans, selectedPlanIdValue }: { plans: Layer1SelectedPlan[]; selectedPlanIdValue?: string }) {
  if (plans.length === 0) {
    return <p className="small-note">Create a plan in the Workspace before building a Layer 1 model.</p>;
  }
  return (
    <form className="plan-selector" action="/layer1">
      <label className="field compact-field">
        <span>Selected plan</span>
        <select name="planId" defaultValue={selectedPlanIdValue} aria-label="Selected Layer 1 plan">
          {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
        </select>
      </label>
      <button className="button button-secondary" type="submit">Open</button>
    </form>
  );
}

export function EmptyPlanState() {
  return (
    <section className="card placeholder">
      <h2>No plan selected</h2>
      <p>Layer 1 records belong to a tenant-scoped plan. Create a workspace plan first, then return here to build the demand-to-budget model.</p>
      <Link className="button button-link" href="/workspace">Go to Workspace</Link>
    </section>
  );
}

export function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: 'warm' | 'green' }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong>{tone ? <Badge tone={tone}>{tone === 'green' ? 'Good' : 'Watch'}</Badge> : null}</article>;
}

export function money(value: unknown): string {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(Number.isFinite(number) ? number : 0);
}

export function num(value: unknown, digits = 2): string {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number.isFinite(number) ? number : 0);
}

export function percent(value: unknown): string {
  const number = Number(value ?? 0);
  return `${num(number * 100, 1)}%`;
}
