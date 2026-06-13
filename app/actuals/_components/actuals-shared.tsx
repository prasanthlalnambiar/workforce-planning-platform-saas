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

export function signedNum(value: unknown, digits = 2): string {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number === 0) return num(0, digits);
  return `${number > 0 ? '+' : ''}${num(number, digits)}`;
}

export function pct(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number > 0 ? '+' : ''}${num(number, 1)}%`;
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

export function StatusBadge({ status, extra }: { status: unknown; extra?: string }) {
  const value = String(status ?? 'draft');
  const tone = value === 'posted' || value === 'locked' ? 'green' : value === 'draft' || value === 'validated' ? 'warm' : undefined;
  return (
    <>
      <Badge tone={tone}>{statusLabel(value)}</Badge>
      {extra ? <Badge tone="green">{extra}</Badge> : null}
    </>
  );
}

export function StatCard({ label, value, note, tone }: { label: string; value: string | number; note?: string; tone?: 'green' | 'warm' }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <p className="small-note">{note}</p> : null}
      {tone ? <Badge tone={tone}>{tone === 'green' ? 'Official' : 'In progress'}</Badge> : null}
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

export function ActualsBoundaryNote() {
  return (
    <p className="small-note">
      Posted actuals are immutable; corrections create a new version. Actuals must map to existing planning periods —
      unmapped rows are rejected, never silently re-assigned. Waterfall reporting and AI commentary are future phases.
    </p>
  );
}

export function VarianceBoundaryNote() {
  return (
    <p className="small-note">
      Variance is pinned to the selected locked forecast version. Later forecast locks do not rewrite this variance
      report. Sign convention: positive cost variance = actual above the comparator (over forecast / over baseline).
      Waterfall reporting and AI commentary are future phases.
    </p>
  );
}
