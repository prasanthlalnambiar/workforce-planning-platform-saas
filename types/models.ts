import type { RoleName } from './roles';

export interface Organisation {
  id: string;
  name: string;
  industry?: string | null;
  country?: string | null;
  default_currency: string;
  fiscal_year_start_month: number;
  timezone: string;
  status: 'active' | 'paused' | 'archived';
}

export interface Profile {
  id: string;
  email: string;
  full_name?: string | null;
  default_organisation_id?: string | null;
  status: 'active' | 'invited' | 'disabled';
}

export interface UserContext {
  userId: string;
  organisationId: string;
  email: string;
  fullName?: string | null;
  roles: RoleName[];
}

export interface Plan {
  id: string;
  organisation_id: string;
  plan_name: string;
  plan_description?: string | null;
  plan_type: 'workforce_budget_governance';
  status: 'draft' | 'active' | 'archived';
}

export interface FiscalYearInput {
  organisationId: string;
  planId: string;
  fiscalYearLabel: string;
  startDate: string;
  createdBy: string;
}

export interface PlanningPeriodDraft {
  organisation_id: string;
  fiscal_year_id?: string;
  period_number: number;
  period_start: string;
  period_end: string;
  period_label: string;
  status: 'future_unlocked' | 'current_open' | 'actuals_pending' | 'forecast_locked' | 'closed';
  editable: boolean;
}

export interface AuditEventInput {
  organisationId: string;
  actorUserId: string;
  eventType: string;
  entityType: string;
  entityId?: string | null;
  planId?: string | null;
  fiscalYearId?: string | null;
  planningPeriodId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  requestId?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface AuditEventInsert {
  organisation_id: string;
  actor_user_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  plan_id: string | null;
  fiscal_year_id: string | null;
  planning_period_id: string | null;
  old_value_json: unknown | null;
  new_value_json: unknown | null;
  reason: string | null;
  request_id: string | null;
  user_agent: string | null;
  ip_address: string | null;
}
