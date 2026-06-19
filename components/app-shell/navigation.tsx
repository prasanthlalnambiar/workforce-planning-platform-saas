'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PRIMARY_NAV, UTILITY_NAV, tabForRoute } from '../../lib/navigation/planning-cockpit';

export function Navigation() {
  const pathname = usePathname() ?? '';
  const activeTab = tabForRoute(pathname);

  return (
    <nav className="nav" aria-label="Planning navigation">
      <div className="nav-primary">
        {PRIMARY_NAV.map(({ tab, href }) => (
          <Link key={tab} href={href} aria-current={activeTab === tab ? 'page' : undefined} className={activeTab === tab ? 'nav-active' : undefined}>
            <span>{tab}</span>
          </Link>
        ))}
      </div>
      <div className="nav-utility" aria-label="Utility navigation">
        <p className="nav-utility-label">More</p>
        {UTILITY_NAV.map(({ label, href }) => (
          <Link key={label} href={href}>
            <span>{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
