import Link from 'next/link';
import { AppShell } from '../../components/app-shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { requireUserContext } from '../../lib/auth/session';
import { getCockpitSummary } from '../../lib/repositories/cockpit-summary';
import { Layer1Subnav } from '../layer1/_components/layer1-shared';

export const dynamic = 'force-dynamic';

export default async function TrackOverviewPage() {
  const context = await requireUserContext();
  const summary = await getCockpitSummary(context).catch(() => null);
  const track = summary?.jobs.find((j) => j.job === 'Track') ?? null;
  const forecast = summary?.jobs.find((j) => j.job === 'Forecast & Budget') ?? null;

  // Track-scoped guidance — NOT the global next action. Tracking only becomes
  // actionable once a forecast/budget is locked; before that, Track is waiting on
  // upstream, and we say so plainly rather than surfacing an upstream step like
  // "Set change drivers" inside Track.
  const trackStatus = track?.status ?? 'Waiting';
  let trackGuidance: { label: string; href?: string };
  if (summary?.unavailable) {
    trackGuidance = { label: 'Tracking status is unavailable right now.' };
  } else if (trackStatus === 'Waiting') {
    trackGuidance = forecast?.status === 'Complete'
      ? { label: 'Post your first actuals to begin tracking.', href: '/actuals' }
      : { label: 'Tracking is waiting until Forecast & Budget is locked.', href: '/layer1/review' };
  } else if (trackStatus === 'Current') {
    trackGuidance = { label: 'Post actuals, then create a variance report.', href: '/variance' };
  } else {
    trackGuidance = { label: 'Review variance and the waterfall, then read the Planning Advisor.', href: '/ai' };
  }

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Track" title="Track Overview" badge="Read only">
          How are we performing against plan, and what changed? This overview summarises the
          latest locked position and points to the next tracking step. It reads governed data
          only and changes nothing.
        </PageHeader>

        <Layer1Subnav tab="Track" />

        <section className="card">
          <p className="eyebrow">Current tracking status</p>
          {summary?.unavailable ? (
            <p className="small-note">Tracking status is unavailable right now.</p>
          ) : (
            <p>
              Track status: <strong>{trackStatus}</strong>.
            </p>
          )}
          <div style={{ marginTop: 14 }}>
            <p className="small-note">Next tracking step</p>
            <div className="split-row" style={{ alignItems: 'center' }}>
              <strong>{trackGuidance.label}</strong>
              {trackGuidance.href ? <Link className="button button-link" href={trackGuidance.href}>Go</Link> : null}
            </div>
          </div>
        </section>

        <section className="card">
          <p className="eyebrow">The tracking flow</p>
          <p className="small-note">
            Actuals → Variance → Waterfall → Planning Advisor. Each step reads the deterministic,
            governed result of the one before it.
          </p>
          <div className="split-row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <Link className="button button-secondary button-link" href="/actuals">Actuals</Link>
            <Link className="button button-secondary button-link" href="/variance">Variance</Link>
            <Link className="button button-secondary button-link" href="/waterfall">Waterfall</Link>
            <Link className="button button-secondary button-link" href="/ai">Planning Advisor</Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
