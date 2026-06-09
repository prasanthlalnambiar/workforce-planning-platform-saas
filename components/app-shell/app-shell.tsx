import { Navigation } from './navigation';
import type { UserContext } from '../../types/models';

export function AppShell({ context, children }: { context: UserContext; children: React.ReactNode }) {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">WP</div>
          <div>
            <strong>Workforce Planning</strong>
            <span>Budget Governance Platform</span>
          </div>
        </div>
        <Navigation />
      </aside>
      <div>
        <header className="topbar">
          <div>
            <strong>{context.email}</strong>
            <span>{context.roles.join(', ') || 'No role'} · Organisation scoped</span>
          </div>
          <form action="/auth/sign-out" method="post">
            <button className="button button-secondary" type="submit">Sign out</button>
          </form>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
