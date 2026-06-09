import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMonthlyPlanningPeriods } from '../lib/services/planning-periods.ts';

test('generates 12 monthly planning periods for a fiscal year', () => {
  const periods = generateMonthlyPlanningPeriods({
    organisationId: 'org-1',
    fiscalYearStartDate: '2026-07-01'
  });

  assert.equal(periods.length, 12);
  assert.equal(periods[0].period_number, 1);
  assert.equal(periods[0].period_start, '2026-07-01');
  assert.equal(periods[0].status, 'current_open');
  assert.equal(periods[11].period_number, 12);
  assert.equal(periods[11].period_end, '2027-06-30');
  assert.ok(periods.every((period) => period.organisation_id === 'org-1'));
});

test('rejects invalid fiscal year start date', () => {
  assert.throws(() => generateMonthlyPlanningPeriods({ organisationId: 'org-1', fiscalYearStartDate: 'not-a-date' }), /Valid fiscal year start date/);
});
