import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuditEvent } from '../lib/audit/audit-service';

test('builds organisation-scoped audit payload', () => {
  const event = buildAuditEvent({
    organisationId: 'org-1',
    actorUserId: 'user-1',
    eventType: 'plan.created',
    entityType: 'plan',
    entityId: 'plan-1',
    newValue: { plan_name: 'FY2027 Plan' },
    reason: 'test'
  });

  assert.equal(event.organisation_id, 'org-1');
  assert.equal(event.actor_user_id, 'user-1');
  assert.equal(event.event_type, 'plan.created');
  assert.deepEqual(event.new_value_json, { plan_name: 'FY2027 Plan' });
});

test('audit payload requires organisation and actor', () => {
  assert.throws(() => buildAuditEvent({ organisationId: '', actorUserId: 'user-1', eventType: 'x', entityType: 'y' }), /organisationId/);
  assert.throws(() => buildAuditEvent({ organisationId: 'org-1', actorUserId: '', eventType: 'x', entityType: 'y' }), /actorUserId/);
});
