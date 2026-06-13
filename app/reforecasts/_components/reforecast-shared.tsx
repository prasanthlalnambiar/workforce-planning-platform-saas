import { Badge } from '../../../components/ui/badge';

export type JsonRecord = Record<string, unknown>;

export function text(value: unknown, fallback = 'Not set'): string {
  const candidate = String(value ?? '').trim();
  return candidate || fallback;
}

export function money(value: unknown): string {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(Number.isFinite(number) ? number : 0);
}

export function num(value: unknown, digits = 2): string {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number.isFinite(number) ? number : 0);
}

export function signedMoney(value: unknown): string {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number === 0) return money(0);
  return `${number > 0 ? '+' : '-'}${money(Math.abs(number))}`;
}

export function displayDate(value: unknown): string {
  if (!value) return 'Not set';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

export function periodLabel(value: unknown): string {
  if (!value) return 'Not set';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' });
}

export function statusLabel(status: unknown): string {
  return text(status, 'draft').replaceAll('_', ' ');
}

export function ReforecastStatusBadge({ status, isCurrent }: { status: unknown; isCurrent?: unknown }) {
  const value = String(status ?? 'draft');
  const tone = value === 'locked' ? 'green' : value === 'draft' || value === 'in_review' ? 'warm' : undefined;
  return (
    <>
      <Badge tone={tone}>{statusLabel(value)}</Badge>
      {isCurrent === true ? <Badge tone="green">current valid forecast</Badge> : null}
    </>
  );
}

export function StatCard({ label, value, note, tone }: { label: string; value: string | number; note?: string; tone?: 'green' | 'warm' }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <p className="small-note">{note}</p> : null}
      {tone ? <Badge tone={tone}>{tone === 'green' ? 'Official' : 'Scenario'}</Badge> : null}
    </article>
  );
}

export function planName(plans: JsonRecord[], planId: unknown): string {
  const plan = plans.find((candidate) => String(candidate.id) === String(planId));
  return plan ? text(plan.plan_name) : 'Unknown plan';
}

export function fiscalYearLabel(fiscalYears: JsonRecord[], fiscalYearId: unknown): string {
  const fiscalYear = fiscalYears.find((candidate) => String(candidate.id) === String(fiscalYearId));
  return fiscalYear ? text(fiscalYear.fiscal_year_label) : 'Unknown fiscal year';
}

export function PhaseBoundaryNote() {
  return (
    <p className="small-note">
      Only approved drivers are included in the official forecast. Proposed drivers are scenario-only.
      Locked forecasts are immutable. Actuals and variance are future phases.
    </p>
  );
}
