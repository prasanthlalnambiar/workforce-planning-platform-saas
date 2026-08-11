// UX 1.0 Planning Cockpit — route-to-tab mapping.
//
// Single source of truth for the user-facing navigation. Primary tabs are the
// five operator jobs; the utility cluster is separate and quieter. The same
// mapping drives the nav, active-tab highlighting, and breadcrumbs, so they can
// never drift apart. This is presentation only. It mostly groups EXISTING routes;
// UX-1.5 also introduces a few read-only routes (Track Overview, Forecast Visuals,
// and two WP-3 placeholder pages) that carry no engine, DB, or governance logic.

export type PrimaryTab = 'Home' | 'Inputs' | 'Assumptions' | 'Forecast & Budget' | 'Track';

export interface PrimaryNavItem {
  tab: PrimaryTab;
  href: string;
}

// Primary navigation, in order. Each tab links to the representative landing
// route for that job (the route itself is unchanged on disk).
export const PRIMARY_NAV: PrimaryNavItem[] = [
  { tab: 'Home', href: '/workspace' },
  { tab: 'Inputs', href: '/layer1/input-sources' },
  { tab: 'Assumptions', href: '/layer1/assumptions' },
  { tab: 'Forecast & Budget', href: '/layer1/output' },
  { tab: 'Track', href: '/track' }
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

  // Inputs — what demand data am I loading
  { prefix: '/layer1/brief', meta: { tab: 'Inputs', leaf: 'Plan Context' } },
  { prefix: '/layer1/sources', meta: { tab: 'Inputs', leaf: 'Operational Demand Data' } },
  { prefix: '/layer1/input-sources', meta: { tab: 'Inputs', leaf: 'Operational Demand Data' } },
  { prefix: '/layer1/demand', meta: { tab: 'Inputs', leaf: 'Advanced Manual Input' } },

  // Assumptions — levers that convert demand into people and cost
  { prefix: '/layer1/assumptions', meta: { tab: 'Assumptions', leaf: 'Capacity Rules' } },
  { prefix: '/dimensions', meta: { tab: 'Assumptions', leaf: 'Locations & Segments' } },
  { prefix: '/drivers', meta: { tab: 'Assumptions', leaf: 'Change Drivers' } },
  { prefix: '/assumptions/workflow-mapping', meta: { tab: 'Assumptions', leaf: 'Workflow Mapping' } },
  { prefix: '/assumptions/location-vendor-split', meta: { tab: 'Assumptions', leaf: 'Location & Vendor Split' } },

  // Forecast & Budget — what we need, what it costs, the official position
  { prefix: '/layer1/output', meta: { tab: 'Forecast & Budget', leaf: 'Forecast Output' } },
  { prefix: '/forecast/visuals', meta: { tab: 'Forecast & Budget', leaf: 'Visuals' } },
  { prefix: '/layer1/scenarios', meta: { tab: 'Forecast & Budget', leaf: 'Scenarios' } },
  { prefix: '/layer1/review', meta: { tab: 'Forecast & Budget', leaf: 'Review & Lock' } },
  { prefix: '/baseline', meta: { tab: 'Forecast & Budget', leaf: 'Budget Baseline' } },
  { prefix: '/reforecasts', meta: { tab: 'Forecast & Budget', leaf: 'Reforecast' } },
  { prefix: '/reforecast', meta: { tab: 'Forecast & Budget', leaf: 'Reforecast' } },

  // Track — how are we tracking, what changed, how to explain it
  { prefix: '/track', meta: { tab: 'Track', leaf: 'Track Overview' } },
  { prefix: '/actuals', meta: { tab: 'Track', leaf: 'Actuals' } },
  { prefix: '/variance', meta: { tab: 'Track', leaf: 'Variance' } },
  { prefix: '/waterfall', meta: { tab: 'Track', leaf: 'Waterfall' } },
  { prefix: '/ai', meta: { tab: 'Track', leaf: 'Planning Advisor' } },

  // The remaining Layer 1 root is an Inputs landing; keep last so the more
  // specific /layer1/* entries above win.
  { prefix: '/layer1', meta: { tab: 'Inputs', leaf: 'Operational Demand Data' } }
];

// Per-tab subnav (the STEPS within each job). Replaces the old mixed Layer 1
// subnav. Each entry links to an existing route (or an in-page anchor on the
// source detail page); nothing here creates a new destination silently.
export interface SubnavItem {
  label: string;
  href: string;
  note?: string; // shown for placeholder/coming-later steps
}

export const TAB_SUBNAV: Record<PrimaryTab, SubnavItem[]> = {
  Home: [],
  Inputs: [
    { label: 'Operational Demand Data', href: '/layer1/input-sources' },
    { label: 'Advanced Manual Input', href: '/layer1/demand' }
  ],
  Assumptions: [
    { label: 'Capacity Rules', href: '/layer1/assumptions' },
    { label: 'Cost Rules', href: '/layer1/assumptions#cost' },
    { label: 'Change Drivers', href: '/drivers' },
    { label: 'Locations & Segments', href: '/dimensions' },
    { label: 'Workflow Mapping', href: '/assumptions/workflow-mapping', note: 'Later step' },
    { label: 'Location & Vendor Split', href: '/assumptions/location-vendor-split', note: 'Later step' }
  ],
  'Forecast & Budget': [
    { label: 'Forecast Output', href: '/layer1/output' },
    { label: 'Visuals', href: '/forecast/visuals' },
    { label: 'Scenarios', href: '/layer1/scenarios' },
    { label: 'Review & Lock', href: '/layer1/review' },
    { label: 'Budget Baseline', href: '/baseline' },
    { label: 'Reforecast', href: '/reforecasts' }
  ],
  Track: [
    { label: 'Track Overview', href: '/track' },
    { label: 'Actuals', href: '/actuals' },
    { label: 'Variance', href: '/variance' },
    { label: 'Waterfall', href: '/waterfall' },
    { label: 'Planning Advisor', href: '/ai' }
  ]
};

/** Subnav steps for the tab that owns a route (for the per-tab inner nav). */
export function subnavForRoute(pathname: string): SubnavItem[] {
  const tab = tabForRoute(pathname);
  return tab ? TAB_SUBNAV[tab] : [];
}

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
