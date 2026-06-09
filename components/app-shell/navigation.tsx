import Link from 'next/link';

const navItems = [
  ['Workspace', '/workspace', 'Phase 1'],
  ['Fiscal Years', '/fiscal-years', 'Phase 1'],
  ['Dimensions', '/dimensions', 'Phase 1'],
  ['Layer 1 Demand Engine', '/layer1', 'Phase 2'],
  ['Budget Baseline', '/baseline', 'Phase 4'],
  ['Drivers', '/drivers', 'Phase 5'],
  ['Reforecast', '/reforecast', 'Phase 6'],
  ['Actuals', '/actuals', 'Phase 7'],
  ['Variance', '/variance', 'Phase 8'],
  ['Waterfall', '/waterfall', 'Phase 8'],
  ['AI Advisory', '/ai', 'Phase 9'],
  ['Audit', '/audit', 'Phase 1'],
  ['Settings', '/settings', 'Phase 1']
] as const;

export function Navigation() {
  return (
    <nav className="nav" aria-label="Product navigation">
      {navItems.map(([label, href, phase]) => (
        <Link key={href} href={href}>
          <span>{label}</span>
          <small>{phase}</small>
        </Link>
      ))}
    </nav>
  );
}
