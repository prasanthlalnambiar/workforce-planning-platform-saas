import { AppShell } from '../../components/app-shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { requireUserContext } from '../../lib/auth/session';
import { listAuditEvents } from '../../lib/repositories/audit-events';


export const dynamic = 'force-dynamic';
export default async function AuditPage() {
  const context = await requireUserContext();
  const events = await listAuditEvents(context).catch(() => []);
  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Governance foundation" title="Audit Log" badge="Tenant scoped">
          Every material action should write an organisation-scoped audit event. Later phases reuse this exact pattern.
        </PageHeader>
        <section className="card">
          <div className="table-wrap"><table><thead><tr><th>Time</th><th>Event</th><th>Entity</th><th>Reason</th></tr></thead><tbody>
            {events.map((event) => <tr key={String(event.id)}><td>{String(event.created_at)}</td><td>{String(event.event_type)}</td><td>{String(event.entity_type)}</td><td>{String(event.reason ?? '')}</td></tr>)}
            {events.length === 0 ? <tr><td colSpan={4}>No audit events visible for this role yet.</td></tr> : null}
          </tbody></table></div>
        </section>
      </div>
    </AppShell>
  );
}
