// UX 1.0 Planning Cockpit — route-to-tab mapping.
//
// Single source of truth for the user-facing navigation. Primary tabs are the
// five operator jobs; the utility cluster is separate and quieter. The same
// mapping drives the nav, active-tab highlighting, and breadcrumbs, so they can
// never drift apart. This is presentation only — it groups EXISTING routes and
// creates none.

export type PrimaryTab = 'Home' | 'Inputs' | 'Assumptions' | 'Forecast & Budget' | 'Track';

export interface PrimaryNavItem {
  tab: PrimaryTab;
  href: string;
}

// Primary navigation, in order. Each tab links to the representative landing
// route for that job (the route itself is unchanged on disk).
export const PRIMARY_NAV: PrimaryNavItem[] = [
  { tab: 'Home', href: '/workspace' },
  { tab: 'Inputs', href: '/layer1' },
  { tab: 'Assumptions', href: '/layer1/assumptions' },
  { tab: 'Forecast & Budget', href: '/baseline' },
  { tab: 'Track', href: '/actuals' }
];

export interface UtilityNavItem {
  label: string;
  href: string;
}

export const UTILITY_NAV: UtilityNavItem[] = [
  { label: 'Audit', href: '/audit' },
  { label: 'Settings', href: '/settings' },
  { label: 'Admin / Fiscal Years', href: '/fiscal-years' },
  { label: 'Account', href: '/settings' }
];

// One breadcrumb leaf label per underlying route, plus its parent job. The
// breadcrumb reads Home / {tab} / {leaf}; Home itself is just Home.
interface RouteMeta {
  tab: PrimaryTab;
  leaf: string;
}

// Ordered most-specific-first so longer paths match before their parents.
const ROUTE_TABLE: { prefix: string; meta: RouteMeta }[] = [
  { prefix: '/workspace', meta: { tab: 'Home', leaf: 'Home' } },

  // Inputs — what work am I planning for
  { prefix: '/layer1/brief', meta: { tab: 'Inputs', leaf: 'Planning Brief' } },
  { prefix: '/layer1/sources', meta: { tab: 'Inputs', leaf: 'Demand Sources' } },
  { prefix: '/layer1/demand', meta: { tab: 'Inputs', leaf: 'Demand Inputs' } },

  // Assumptions — levers that convert demand into people and cost
  { prefix: '/layer1/assumptions', meta: { tab: 'Assumptions', leaf: 'Capacity Assumptions' } },
  { prefix: '/layer1/scenarios', meta: { tab: 'Assumptions', leaf: 'Scenarios' } },
  { prefix: '/dimensions', meta: { tab: 'Assumptions', leaf: 'Locations & Segments' } },
  { prefix: '/drivers', meta: { tab: 'Assumptions', leaf: 'Change Drivers' } },

  // Forecast & Budget — what we need, what it costs, the official position
  { prefix: '/layer1/output', meta: { tab: 'Forecast & Budget', leaf: 'Forecast Output' } },
  { prefix: '/layer1/review', meta: { tab: 'Forecast & Budget', leaf: 'Review & Lock' } },
  { prefix: '/baseline', meta: { tab: 'Forecast & Budget', leaf: 'Budget Baseline' } },
  { prefix: '/reforecasts', meta: { tab: 'Forecast & Budget', leaf: 'Reforecast' } },
  { prefix: '/reforecast', meta: { tab: 'Forecast & Budget', leaf: 'Reforecast' } },

  // Track — how are we tracking, what changed, how to explain it
  { prefix: '/actuals', meta: { tab: 'Track', leaf: 'Actuals' } },
  { prefix: '/variance', meta: { tab: 'Track', leaf: 'Variance' } },
  { prefix: '/waterfall', meta: { tab: 'Track', leaf: 'Waterfall' } },
  { prefix: '/ai', meta: { tab: 'Track', leaf: 'Planning Advisor' } },

  // The remaining Layer 1 root is an Inputs landing; keep last so the more
  // specific /layer1/* entries above win.
  { prefix: '/layer1', meta: { tab: 'Inputs', leaf: 'Demand Inputs' } }
];

/** Resolve the primary tab that owns a given pathname (for active-tab state). */
export function tabForRoute(pathname: string): PrimaryTab | null {
  const match = ROUTE_TABLE.find((entry) => pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`));
  return match ? match.meta.tab : null;
}

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Breadcrumb trail for a route: Home / {tab} / {leaf}. Home maps to just Home.
 * The tab crumb links to that tab's landing route; the leaf is the current page.
 */
export function breadcrumbsForRoute(pathname: string): Crumb[] {
  const match = ROUTE_TABLE.find((entry) => pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`));
  if (!match) return [{ label: 'Home', href: '/workspace' }];
  if (match.meta.tab === 'Home') return [{ label: 'Home' }];

  const tabLanding = PRIMARY_NAV.find((item) => item.tab === match.meta.tab);
  return [
    { label: 'Home', href: '/workspace' },
    { label: match.meta.tab, href: tabLanding?.href },
    { label: match.meta.leaf }
  ];
}
