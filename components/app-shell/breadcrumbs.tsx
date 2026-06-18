'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { breadcrumbsForRoute } from '../../lib/navigation/planning-cockpit';

export function Breadcrumbs() {
  const pathname = usePathname() ?? '';
  const crumbs = breadcrumbsForRoute(pathname);

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        return (
          <span key={`${crumb.label}-${index}`} className="breadcrumb-item">
            {crumb.href && !isLast ? (
              <Link href={crumb.href}>{crumb.label}</Link>
            ) : (
              <span aria-current={isLast ? 'page' : undefined}>{crumb.label}</span>
            )}
            {!isLast ? <span className="breadcrumb-sep" aria-hidden="true"> / </span> : null}
          </span>
        );
      })}
    </nav>
  );
}
