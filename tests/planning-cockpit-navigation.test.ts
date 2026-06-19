import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  PRIMARY_NAV,
  UTILITY_NAV,
  tabForRoute,
  breadcrumbsForRoute
} from '../lib/navigation/planning-cockpit';

test('primary navigation contains exactly Home, Inputs, Assumptions, Forecast & Budget, Track', () => {
  assert.deepEqual(PRIMARY_NAV.map((item) => item.tab), ['Home', 'Inputs', 'Assumptions', 'Forecast & Budget', 'Track']);
});

test('utility navigation contains Audit, Settings, Admin / Fiscal Years, Account', () => {
  const labels = UTILITY_NAV.map((item) => item.label);
  for (const expected of ['Audit', 'Settings', 'Admin / Fiscal Years', 'Account']) {
    assert.ok(labels.includes(expected), `utility nav has ${expected}`);
  }
});

test('active-tab mapping covers every underlying route per the spec', () => {
  const cases: [string, string][] = [
    ['/workspace', 'Home'],
    ['/layer1', 'Inputs'],
    ['/layer1/brief', 'Inputs'],
    ['/layer1/sources', 'Inputs'],
    ['/layer1/demand', 'Inputs'],
    ['/layer1/assumptions', 'Assumptions'],
    ['/layer1/scenarios', 'Assumptions'],
    ['/dimensions', 'Assumptions'],
    ['/drivers', 'Assumptions'],
    ['/layer1/output', 'Forecast & Budget'],
    ['/layer1/review', 'Forecast & Budget'],
    ['/baseline', 'Forecast & Budget'],
    ['/reforecasts', 'Forecast & Budget'],
    ['/actuals', 'Track'],
    ['/variance', 'Track'],
    ['/waterfall', 'Track'],
    ['/ai', 'Track']
  ];
  for (const [route, tab] of cases) {
    assert.equal(tabForRoute(route), tab, `${route} → ${tab}`);
  }
});

test('active-tab mapping resolves nested/detail routes to their parent job', () => {
  assert.equal(tabForRoute('/drivers/abc-123'), 'Assumptions');
  assert.equal(tabForRoute('/baseline/xyz'), 'Forecast & Budget');
  assert.equal(tabForRoute('/waterfall/report-1'), 'Track');
  assert.equal(tabForRoute('/ai/report-1'), 'Track');
  assert.equal(tabForRoute('/layer1/assumptions/anything'), 'Assumptions');
});

test('breadcrumbs render Home / {tab} / {leaf} for representative routes', () => {
  const labels = (path: string) => breadcrumbsForRoute(path).map((c) => c.label);
  assert.deepEqual(labels('/drivers'), ['Home', 'Assumptions', 'Change Drivers']);
  assert.deepEqual(labels('/baseline'), ['Home', 'Forecast & Budget', 'Budget Baseline']);
  assert.deepEqual(labels('/layer1/review'), ['Home', 'Forecast & Budget', 'Review & Lock']);
  assert.deepEqual(labels('/waterfall'), ['Home', 'Track', 'Waterfall']);
  assert.deepEqual(labels('/ai'), ['Home', 'Track', 'Planning Advisor']);
  assert.deepEqual(labels('/workspace'), ['Home']);
});

test('the breadcrumb tab crumb links to that tab\'s landing route', () => {
  const crumbs = breadcrumbsForRoute('/drivers');
  const tabCrumb = crumbs.find((c) => c.label === 'Assumptions');
  assert.ok(tabCrumb?.href, 'tab crumb is a link');
  assert.equal(tabCrumb?.href, '/layer1/assumptions');
});

test('existing routes remain accessible on disk (none deleted or moved)', () => {
  const routes = [
    'workspace', 'layer1', 'layer1/brief', 'layer1/sources', 'layer1/demand',
    'layer1/assumptions', 'layer1/scenarios', 'layer1/output', 'dimensions',
    'drivers', 'baseline', 'reforecasts', 'actuals', 'variance', 'waterfall',
    'ai', 'audit', 'settings', 'fiscal-years'
  ];
  for (const r of routes) {
    assert.ok(existsSync(new URL(`../app/${r}/page.tsx`, import.meta.url)), `/${r} route file exists`);
  }
});

test('no new top-level job routes were introduced', () => {
  for (const r of ['inputs', 'assumptions', 'forecast-budget', 'track']) {
    assert.ok(!existsSync(new URL(`../app/${r}/page.tsx`, import.meta.url)), `/${r} must NOT be created`);
  }
});

test('the navigation component is built from the mapping and shows no phase labels', () => {
  const nav = readFileSync(new URL('../components/app-shell/navigation.tsx', import.meta.url), 'utf8');
  assert.match(nav, /PRIMARY_NAV/);
  assert.match(nav, /UTILITY_NAV/);
  assert.match(nav, /tabForRoute/);
  assert.ok(!/Phase \d/.test(nav), 'no Phase N labels in nav');
  assert.ok(!nav.includes('Layer 1'), 'no Layer 1 label in nav');
});
