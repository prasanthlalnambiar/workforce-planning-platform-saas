import { createDimensionAction } from '../actions';
import { AppShell } from '../../components/app-shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { requireUserContext } from '../../lib/auth/session';
import { listDimension, type DimensionTable } from '../../lib/repositories/dimensions';
import { hasPermission } from '../../lib/permissions/permissions';


export const dynamic = 'force-dynamic';
const dimensionTables: { table: DimensionTable; label: string }[] = [
  { table: 'regions', label: 'Regions' },
  { table: 'locations', label: 'Locations' },
  { table: 'channels', label: 'Channels' },
  { table: 'work_types', label: 'Work Types' },
  { table: 'workforce_groups', label: 'Workforce Groups' }
];

export default async function DimensionsPage() {
  const context = await requireUserContext();
  const canWrite = hasPermission(context.roles, 'dimensions:write');
  const data = await Promise.all(dimensionTables.map(async (item) => ({ ...item, rows: await listDimension(context, item.table) })));

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Shared foundation" title="Shared Dimensions" badge="Tenant scoped">
          Foundation dimensions used across demand and forecast models. These are kept simple and governed.
        </PageHeader>
        <section className="grid-2">
          {data.map(({ table, label, rows }) => (
            <article className="card" key={table}>
              <h2>{label}</h2>
              <form className="form-grid" action={createDimensionAction}>
                <input type="hidden" name="dimension_table" value={table} />
                <label className="field"><span>Name</span><input name="name" required /></label>
                <button className="button" disabled={!canWrite} type="submit">Add</button>
              </form>
              <div className="table-wrap"><table><thead><tr><th>Name</th><th>Active</th></tr></thead><tbody>
                {rows.map((row) => <tr key={String(row.id)}><td>{String(row.name)}</td><td>{String(row.active)}</td></tr>)}
                {rows.length === 0 ? <tr><td colSpan={2}>No records yet.</td></tr> : null}
              </tbody></table></div>
            </article>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
