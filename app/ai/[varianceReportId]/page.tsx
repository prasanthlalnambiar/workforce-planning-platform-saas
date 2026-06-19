import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '../../../components/app-shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { requireUserContext } from '../../../lib/auth/session';
import { getAdvisoryDetail } from '../../../lib/repositories/advisory';
import { ControlledState, text } from '../../waterfall/_components/waterfall-shared';
import { AdvisoryFull } from '../_components/advisory-shared';


export const dynamic = 'force-dynamic';
export default async function AiAdvisoryDetailPage({ params }: { params: Promise<{ varianceReportId: string }> }) {
  const { varianceReportId } = await params;
  const context = await requireUserContext();
  const data = await getAdvisoryDetail(context, varianceReportId);

  if (data.readiness === 'no_locked_variance' && !data.context.varianceReport) {
    notFound();
  }

  const report = data.context.varianceReport;

  if (data.readiness !== 'ready' || !data.advisory) {
    return (
      <AppShell context={context}>
        <div className="stack">
          <PageHeader eyebrow="Planning Advisor" title="Planning Advisor" badge="Advisor">
            No advisory could be produced for this report.
          </PageHeader>
          <ControlledState
            readiness={data.readiness === 'ready' ? 'incomplete_inputs' : data.readiness}
            detail={data.unavailableReason}
          />
          <p><Link className="button button-secondary button-link" href="/ai">Back to advisory workspace</Link></p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader
          eyebrow="Planning Advisor"
          title={`Advisory · ${text(report?.report_code)}`}
          badge="Advisor"
        >
          A plain-language explanation of the locked waterfall for {text(report?.report_name, 'this report')}. Every
          figure referenced below is read directly from the deterministic bridge; nothing here is recalculated or
          written back.
        </PageHeader>

        <AdvisoryFull advisory={data.advisory} />

        <div className="split-row">
          <Link className="button button-secondary button-link" href="/ai">Back to advisory workspace</Link>
          <Link className="button button-secondary button-link" href={`/waterfall/${varianceReportId}`}>View the waterfall bridge</Link>
        </div>
      </div>
    </AppShell>
  );
}
