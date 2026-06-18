import { Badge } from '../../../components/ui/badge';
import { WATERFALL_READINESS_MESSAGE, type WaterfallReadiness } from '../../../lib/waterfall/waterfall-engine';

export type JsonRecord = Record<string, unknown>;

export function text(value: unknown, fallback = 'Not set'): string {
  const candidate = String(value ?? '').trim();
  return candidate || fallback;
}

export function money(value: unknown): string {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(Number.isFinite(number) ? number : 0);
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

export function ControlledState({ readiness, detail, issues }: { readiness: Exclude<WaterfallReadiness, 'ready'>; detail?: string | null; issues?: string[] }) {
  const titles: Record<Exclude<WaterfallReadiness, 'ready'>, string> = {
    no_locked_baseline: 'No locked baseline',
    no_locked_forecast: 'No locked forecast',
    no_posted_actuals: 'No posted actuals',
    no_locked_variance: 'No locked variance report',
    incomplete_inputs: 'Incomplete waterfall inputs',
    inconsistent_pinned_sources: 'Inconsistent pinned sources'
  };
  return (
    <section className="card">
      <p className="eyebrow">Controlled state</p>
      <h2>{titles[readiness]}</h2>
      <p>{WATERFALL_READINESS_MESSAGE[readiness]}</p>
      {issues && issues.length > 0 ? (
        <ul className="small-note">
          {issues.map((issue, index) => <li key={index}>{issue}</li>)}
        </ul>
      ) : null}
      {detail ? <p className="small-note">{detail}</p> : null}
      <p className="small-note">
        The waterfall is a read-only explanation built only from locked, immutable records. It never calculates from
        draft or unlocked objects, never calculates from inconsistent pinned sources, and never writes back to any
        upstream record.
      </p>
    </section>
  );
}

export function StatCard({ label, value, note, tone }: { label: string; value: string | number; note?: string; tone?: 'green' | 'warm' }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <p className="small-note">{note}</p> : null}
      {tone ? <Badge tone={tone}>{tone === 'green' ? 'Locked' : 'In progress'}</Badge> : null}
    </article>
  );
}

export function WaterfallBoundaryNote() {
  return (
    <p className="small-note">
      Deterministic bridge only: every figure is read from the locked baseline, the approved drivers captured in the
      locked forecast, the posted actuals and the locked variance report. Proposed drivers and draft records are
      excluded. Planning Advisor explanations are available separately in Track.
    </p>
  );
}
